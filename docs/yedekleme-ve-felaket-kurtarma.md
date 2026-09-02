# Yedekleme ve Felaket Kurtarma (DR) Prosedürü

> **Kapsam:** NomosOS kurulumunda veri kaybı senaryolarına karşı yedekleme,
> geri yükleme ve felaket kurtarma. Geliştirme planı D3 / C6 maddesinin
> belge tarafı — "yedekleme prosedürü belgeli değil" bulgusunu kapatmak için
> yazılmıştır. Kod tarafında `GET /metrics` ucu (Prometheus) eklenmiştir.

## 1. Veri bileşenleri ve kritiklik

| Bileşen | Depo | Kritiklik | RPO hedefi | RTO hedefi |
|---|---|---|---|---|
| PostgreSQL (tüm iş verisi: dosya, müvekkil, süre, belge kaydı, mesaj, fatura) | `postgres` kapsayıcısı / harici DB | **EN YÜKSEK** | 15 dk | 2 saat |
| MinIO/S3 (belge dosyaları, dilekçe çıktıları, avatarlar) | `minio` kapsayıcısı / harici S3 | **YÜKSEK** | 1 saat | 4 saat |
| Redis (kuyruklar, önbellek, hız sınırları) | `redis` kapsayıcısı | ORTA (kaybedilirse kuyruklar yeniden doldurulur) | 1 gün | 1 saat |
| UYAP eşleştirme kuyruğu | PostgreSQL içinde | PostgreSQL ile birlikte | — | — |

**Kural:** PostgreSQL yedeksiz ÇALIŞMAZ. Redis ve MinIO tek kopya da olsa
yeniden inşa edilebilir; PostgreSQL kaybı geri alınamaz.

## 2. Günlük yedekleme (otomatik)

### 2.1 PostgreSQL

```bash
# Her gün 03:00 — pg_dump özel biçim (sıkıştırılmış, paralel geri yüklenebilir)
docker exec nomosos-postgres pg_dump -U nomosos -Fc -d nomosos \
  > /var/backups/nomosos/db/nomosos-$(date +%Y%m%d-%H%M).dump

# 30 günden eski dökümleri temizle
find /var/backups/nomosos/db -name "*.dump" -mtime +30 -delete
```

- **RPO 15 dk isteniyorsa:** WAL arşivleme açılır (`archive_mode=on`,
  `archive_command='cp %p /var/backups/nomosos/wal/%f'`) ve `pgbackrest`
  ya da `wal-g` ile artımlı temel yedek alınır. pg_dump tek başına
  günlük RPO verir.
- **Doğrulama:** her yedekten sonra `pg_restore --list <dump>` çalışır;
  çıktısı boşsa yedek BOZUK sayılır ve alarm verilir.
- **3-2-1 kuralı:** iki farklı ortamda kopya (sunucu diski + harici/nane
  depolama), bunlardan biri coğrafi olarak ayrı.

### 2.2 MinIO/S3

```bash
# mc istemcisiyle kova kopyası (sürüm özellikli kovalarda daha hızlıdır)
mc mirror --overwrite local/nomos-documents /var/backups/nomosos/s3/documents/
```

- Kovalarda **sürüm oluşturma (versioning)** açıktır: yanlışlıkla silinen
  belge sürüm geçmişinden kurtarılır; yedek yalnız disk kaybına karşıdır.

### 2.3 Redis

Kalıcılık AOF+RDB ile açılır (`--appendonly yes`). Yedeklenmesi ZORUNLU
DEĞİLDİR: BullMQ kuyrukları iş kaybını `attempts` yeniden denemesiyle
tolere eder; süre/ajanda gibi KANONİK veri PostgreSQL'dedir.

## 3. Geri yükleme (restore)

### 3.1 PostgreSQL

```bash
# 1) Yeni/boş veritabanı hazırla
docker exec -i nomosos-postgres psql -U nomosos -c "DROP DATABASE nomosos_restore;"
docker exec -i nomosos-postgres psql -U nomosos -c "CREATE DATABASE nomosos_restore;"
# 2) Dökümü geri yükle
docker exec -i nomosos-postgres pg_restore -U nomosos -d nomosos_restore --clean --if-exists \
  < /var/backups/nomosos/db/nomosos-YYYYMMDD-HHMM.dump
# 3) Doğrula: kiracı ve kullanıcı sayısı ile tutarlılık
docker exec -i nomosos-postgres psql -U nomosos -d nomosos_restore \
  -c "SELECT (SELECT count(*) FROM \"Tenant\") AS kiraci, (SELECT count(*) FROM \"User\") AS kullanici;"
# 4) Kesin geçiş: uygulama bağlantı dizesini nomosos_restore'a çevir veya
#    isim değişikliği yap; kısa bir bakım penceresi bildir.
```

### 3.2 MinIO/S3

```bash
mc mirror /var/backups/nomosos/s3/documents/ local/nomos-documents/
```

### 3.3 Uygulama

API kapsayıcısı yeniden başlatılır; ilk açılışta şema bütünlüğü Prisma
tarafından doğrulanır (migration durumu). `/api/v1/health` 200 dönene kadar
trafik yönlendirilmez.

## 4. Felaket kurtarma tatbikatı (üç ayda bir)

1. Yedekten **izole bir ortama** geri yükle (aynı makinede başka port).
2. Uygulamayı izole veritabanına bağla; `/health` → 200.
3. Rastgele 5 dosyada belge indirme + süre görüntüleme doğrula.
4. Süreyi ölç ve bu belgeye işle (hedef RTO ile karşılaştır).
5. Başarısızsa yedekleme zincirindeki BOZUK halkayı bul, düzelt, yeniden dene.

## 5. İzleme ve alarmlar

- `GET /metrics` (Prometheus metin biçimi; `METRICS_TOKEN` taşıyıcısı gerekir)
  süreç, DB erişimi (`nomosos_db_up`) ve iş sayaçlarını yayınlar.
- **Alarm kuralları (asgari):**
  - `nomosos_db_up == 0` 1 dk → kritik.
  - Yedekleme işi 24 saat koşmadı → kritik (cron log kontrolü).
  - `nomosos_process_resident_memory_bytes` 24 saatte iki katına çıkış → uyarı.

## 6. Sorumluluklar

| Rol | Sorumluluk |
|---|---|
| Kurulum sahibi (büro IT) | Günlük yedek cron'unun ÇALIŞTIĞINI doğrulamak, yedekleri dış ortama taşımak |
| NomosOS operasyon | Prosedürün güncelliği, tatbikat takvimi |
| Büro sahibi | Tatbikat raporunu onaylamak |

> **Dürüstlük notu:** bu prosedür, kurulumdaki dosyalara değil ÇALIŞAN
> bir yedekleme zincirine bağlıdır. Kurulumda cron/pgbackrest yapılandırılm-
> mamışsa bu belge bir niyet belgesidir — kurulum kontrol listesindeki
> "yedekleme doğrulandı" maddesi işaretlenmeden üretim açılmaz.
