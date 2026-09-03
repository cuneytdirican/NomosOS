# NomosOS — Dalga 8: Taraf ↔ Müvekkil Bağlantısı (2026-09-03)

Durum: **TAMAM** — canlı doğrulandı.

## 0. Bulgu (kanıtlı)
- `CaseParty` — müvekkil tarafı AD ELLE YAZILIYORDU; `clientId` bağı yoktu.
  API ucu (`POST /cases/:id/parties`) vardı ama ARAYÜZDE taraf ekleme YOKTU
  (taraflar yalnızca seed verisiyle geliyordu, dosya detayında salt-okunur).
- Bilirkişi (Modül 13) ilkeye UYUYORDU: kiracı rehberi (Expert) + raporlarda
  `expertId` doğrulaması — değişiklik gerekmedi.

## 1. Uygulanan
- **Model/migration:** `CaseParty.clientId` (FK → Client, SetNull) + index.
- **API:** müvekkil tarafında AD SUNUCUDA KARTTAN DOLDURULUR (elle gönderilen ad
  yok sayılır); KARTSIZ "müvekkilimiz" işareti 400 ile reddedilir (çatışma
  kontrolünü ve finans özetlerini kandıran kopuk kayıt engellenir). Karşı taraf
  serbest metindir (herkes olabilir — katalog varlığı değildir; bilinçli).
- **Web:** dosya detayı → Taraflar kartına «+ Taraf Ekle»: sıfat + "müvekkilimiz"
  işaretliyse RemoteSelect ile MÜVEKKİL SEÇİMİ (sunucu tarafı aramalı; ad yazılamaz),
  işaretsizse karşı taraf adı; müvekkil tarafı listede kart bağlantısıyla gösterilir.

## 2. Doğrulama (canlı)
Kartsız müvekkil işareti **400**; kart bağlantılı taraf **201** — gönderilen
geçersiz ad ("GECERSIZ-ELLE-AD") sunucuda kart adıyla DEĞİŞTİRİLDİ (adın elle
yazılamadığının kanıtı), `clientId` bağlı; karşı taraf serbest **201**.
44 clients/cases testi (4 yeni D8) · 80 API dosyası · lint 0.
