# Modül 07 — Görev / Workflow Yönetimi

## Amaç

Büroda kritik soru "bu işi kim yapacak?" sorusudur. Benchmark ürün bireysel AI asistanıdır; ekip çalışması, sorumluluk zinciri ve onay hiyerarşisi yoktur. Oysa bir istinaf dilekçesi tek kişinin işi değildir: araştırmayı bir avukat, emsal taramasını stajyer yapar, taslağı başka bir avukat kontrol eder, Partner onaylar, Sekreter UYAP'tan gönderir.

Bu modül tam Legal Workflow zincirini modeller: **Dosya → Görev → Sorumlu → Kontrol eden → Son tarih → Öncelik → Durum → Onay → Tamamlandı.** Beş rol (PARTNER / AVUKAT / STAJYER / SEKRETER / ADMIN) üzerine kurulu yetki matrisi, kim atar / kim yapar / kim onaylar sorularını kesinleştirir.

İkinci katman **workflow şablonlarıdır**: "istinaf süreci" gibi tekrarlanan iş zincirleri WorkflowTemplate olarak tanımlanır; dosyada tetiklendiğinde adımlar bağımlılık sırasıyla göreve dönüşür ve tüm zincirin takvimi, bağlı Deadline'dan (örn. istinaf son günü) geriye doğru hesaplanır. Pipeline (Modül 06) ve AI önerileri (NEXT_STEP_SUGGEST, ENF_NEXT_ACTIONS) de görevlerini bu modül üzerinden, insan onayıyla açar.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, dosyadan görev açıp sorumlu, kontrol eden, son tarih ve öncelik atamak istiyorum ki iş sahipsiz kalmasın.
2. **Stajyer olarak**, `/app/tasks` ekranında bana atanmış görevleri son tarihe göre sıralı görmek istiyorum ki neye önce başlayacağımı bileyim.
3. **Avukat olarak**, tamamladığım görevi "kontrole gönder" ile kontrol edene düşürmek istiyorum ki onay zinciri kendiliğinden aksın.
4. **Partner olarak**, onayımda bekleyen işleri tek kuyrukta görmek ve tek tıkla onaylamak/geri göndermek istiyorum.
5. **Partner olarak**, geri gönderdiğim görevde ret gerekçesi yazmak istiyorum ki düzeltme turu net olsun.
6. **Avukat olarak**, istinaf kararı alındığında "istinaf workflow" şablonunu dosyada tetiklemek istiyorum ki 5 adımlık zincir otomatik kurulsun.
7. **Partner olarak**, ekibin görev yükünü kişi bazında görmek istiyorum ki dağılımı dengeleyeyim.
8. **Sekreter olarak**, "UYAP gönderimi" görevimin ancak Partner onayı tamamlanınca aktifleşmesini istiyorum ki onaysız dilekçe gitmesin.
9. **Avukat olarak**, süresi bir Deadline'a bağlı görevin son tarihinin, süre son gününden en az 2 iş günü önce olmasını istiyorum ki son güne iş kalmasın.
10. **Admin olarak**, workflow şablonlarını rollerle tanımlamak istiyorum (kişiyle değil) ki şablon her dosyada, o dosyanın ekibiyle çalışsın.

## Ekranlar ve UX

### 1. Görevlerim — `/app/tasks`
Sekmeler: Bana Atananlar · Kontrolümde · Onayımda Bekleyen · Açtıklarım. Görünüm: liste / kanban (TODO, IN_PROGRESS, IN_REVIEW, APPROVED, DONE). Filtre: dosya, öncelik, gecikmiş.

```
┌────────────────────────────────────────────────────────────────────┐
│ GÖREVLER  [Bana:7] [Kontrolümde:3] [Onay:2]      [Liste|Kanban]   │
├────────────────────────────────────────────────────────────────────┤
│ 🔴 KRİTİK  İstinaf dilekçesi taslağı      2025/341 · son: 03.09   │
│    Sorumlu: Av. C · Kontrol: Partner D · Durum: IN_PROGRESS        │
│    └ bağlı süre: İstinaf 05.09 (HMK m.345)                         │
│ 🟠 YÜKSEK  Emsal karar taraması           2025/341 · son: 01.09   │
│    Sorumlu: Stj. B · Durum: IN_REVIEW → kontrol: Av. C             │
│ 🟢 NORMAL  Müvekkil bilgilendirme         2026/72  · son: 04.09   │
├────────────────────────────────────────────────────────────────────┤
│ ⏳ ONAYIMDA: "İstinaf dilekçesi v2" — Av. C  [Onayla] [Geri Gönder]│
└────────────────────────────────────────────────────────────────────┘
```

### 2. Görev Detay — `/app/tasks/:id`
Başlık, açıklama, dosya bağı, sorumlu/kontrol eden, son tarih + bağlı Deadline kartı, durum geçmişi (kim, ne zaman, hangi geçiş), yorumlar, ekli belgeler, kontrol/onay aksiyon butonları (role göre).

### 3. Workflow Şablonları — `/app/workflows/templates` (ADMIN/PARTNER)
Şablon listesi; şablon editörü: adımlar, rol atamaları, bağımlılıklar, süre ofsetleri, onay noktaları.

### 4. Ekip Yükü — `/app/tasks/workload` (PARTNER)
Kişi bazlı açık görev / gecikmiş / bu hafta biten matrisi; kişiye tıklayınca görev listesi.

## Veri Modeli

### Task (çekirdek, genişletilmiş)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id / tenant_id | uuid | |
| case_id | uuid FK→Case nullable | Dosyasız büro görevi mümkün |
| title / description | text | |
| assignee_user_id | uuid FK→User | Sorumlu |
| reviewer_user_id | uuid FK→User nullable | Kontrol eden; onay gereken görevde zorunlu |
| created_by | uuid FK→User | |
| due_date | date | |
| priority | enum(LOW, NORMAL, HIGH, CRITICAL) | |
| status | enum(TODO, IN_PROGRESS, IN_REVIEW, APPROVED, DONE, REJECTED, CANCELLED) | REJECTED → sorumluya döner |
| approval_required | bool | true ise DONE'a giden yol IN_REVIEW+APPROVED'dan geçer |
| source | enum(MANUAL, PIPELINE, AI_SUGGESTED, WORKFLOW) | |
| deadline_id | uuid FK→Deadline nullable | Bağlı yasal süre |
| workflow_run_id / workflow_step_no | uuid / int nullable | Şablondan geldiyse |
| blocked_by_task_ids | uuid[] | Bağımlılık: hepsi DONE olmadan başlatılamaz |
| rejection_note | text nullable | Geri gönderme gerekçesi |

### TaskStatusLog (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| task_id | uuid FK→Task | |
| from_status / to_status | enum | |
| actor_user_id | uuid FK→User | |
| note | text nullable | |
| occurred_at | timestamptz | |

### WorkflowTemplate (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id / tenant_id | uuid | |
| code / name | text | ISTINAF_SURECI, "İstinaf Süreci" |
| trigger | enum(MANUAL, STAGE_CHANGE, DEADLINE_CONFIRMED, DOCUMENT_CLASS) nullable | Otomatik tetik (örn. stage→APPEAL) |
| is_active | bool | |

### WorkflowStep (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| template_id | uuid FK→WorkflowTemplate | |
| step_no | int | |
| title | text | |
| assignee_role | enum(PARTNER, AVUKAT, STAJYER, SEKRETER) | Kişi değil rol; tetikte dosya ekibinden çözülür |
| reviewer_role | enum nullable | |
| depends_on_step_nos | int[] | Bağımlılıklar |
| due_offset_days | int | Zincir çapasından (anchor) geriye/ileriye gün |
| approval_required | bool | |

### WorkflowRun (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| template_id / case_id | uuid | |
| anchor_deadline_id | uuid FK→Deadline nullable | Takvim çapası (örn. istinaf son günü) |
| status | enum(RUNNING, COMPLETED, CANCELLED) | |
| started_by / started_at | uuid / timestamptz | |

### Örnek şablon — İstinaf Süreci (seed)
| # | Adım | Rol | Kontrol | Bağımlı | Son tarih (çapa=istinaf son günü) | Onay |
|---|------|-----|---------|---------|-----------------------------------|------|
| 1 | Hukuki araştırma | AVUKAT (A) | — | — | çapa−8 iş günü | hayır |
| 2 | Emsal karar taraması | STAJYER (B) | AVUKAT (A) | — | çapa−8 iş günü | hayır |
| 3 | İstinaf dilekçesi taslağı | AVUKAT (C) | PARTNER | 1, 2 | çapa−4 iş günü | evet |
| 4 | Son okuma ve onay | PARTNER | — | 3 | çapa−2 iş günü | evet |
| 5 | UYAP gönderimi | SEKRETER | AVUKAT (C) | 4 | çapa−1 iş günü | hayır |

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı | Gördüğü veri | KVKK notu |
|-----------|---------------|--------------|-----------|
| TASK_SUGGEST | tetik bağlamı (belge findings, aşama geçişi, copilot önerisi) → taslak görev listesi {title, önerilen rol, önerilen son tarih} | Dosya aşaması, açık görevler, ekip rolleri | Öneri onaysız Task olmaz (source=AI_SUGGESTED, onay kartında) |
| WORKLOAD_SUMMARY | tenant/ekip → kişi bazlı yük özeti + dengeleme önerisi | Görev sayıları, son tarihler (içerik değil, meta) | Görev başlıkları PII maskeleme hattından geçer |

## İş Kuralları

1. Durum makinesi: TODO→IN_PROGRESS→(approval_required ? IN_REVIEW→APPROVED→DONE : DONE); IN_REVIEW'dan REJECTED→IN_PROGRESS (rejection_note zorunlu). Başka geçiş yok; her geçiş TaskStatusLog'a yazılır.
2. `approval_required=true` iken `reviewer_user_id` boş bırakılamaz; sorumlu ile kontrol eden aynı kişi olamaz.
3. Rol yetkileri: STAJYER görev açamaz, yalnız kendine atanan görevi yürütür; SEKRETER görev açabilir ama onay veremez; AVUKAT açar/yürütür/kontrol eder; PARTNER + ADMIN her görevi görebilir, PARTNER onay yetkisinin tek sahibidir (reviewer_role=PARTNER adımlarında); ADMIN operasyonel onay veremez, şablon yönetir.
4. `blocked_by_task_ids` içindeki tüm görevler DONE olmadan görev IN_PROGRESS'e alınamaz; engelleyen görevler kartta listelenir.
5. `deadline_id` bağlı görevde `due_date`, Deadline.due_date−2 iş gününden sonra olamaz; ihlalde kayıt uyarıyla açılır ve Partner'a bildirilir.
6. WorkflowRun tetiklendiğinde adımlar role göre dosya ekibinden kişiye çözülür; rolde birden çok kişi varsa tetikleyen kullanıcı seçim yapar.
7. Çapa Deadline değişirse (tarih düzeltme) zincirdeki tüm açık görevlerin son tarihleri yeniden hesaplanır ve ilgililere bildirilir.
8. Gecikme eskalasyonu: son tarihi geçen görevde sorumluya anında, 24 saat sonra kontrol edene, 48 saat sonra Partner'a bildirim; CRITICAL öncelikte süreler yarıya iner.
9. Görev silinemez; CANCELLED yapılır ve gerekçe istenir. WorkflowRun iptali, zincirin açık görevlerini topluca CANCELLED yapar.
10. `source=PIPELINE/AI_SUGGESTED` görevler ancak onay kartından (Modül 06 proposal veya TASK_SUGGEST onayı) sonra oluşur; sistem doğrudan Task yazmaz.

## API Uçları

| Metod | Yol | Açıklama |
|-------|-----|----------|
| GET | /api/v1/tasks?assignee=&reviewer=&status=&case_id=&overdue= | Liste |
| POST | /api/v1/tasks | Yeni görev (rol kontrolü, kural 2-5) |
| GET/PATCH | /api/v1/tasks/:id | Detay / güncelleme |
| POST | /api/v1/tasks/:id/transition | `{to, note}` — durum makinesi (kural 1) |
| GET | /api/v1/tasks/review-queue | Kontrolümde/onayımda bekleyenler |
| GET | /api/v1/tasks/workload | Ekip yükü matrisi (PARTNER) |
| GET/POST | /api/v1/workflow-templates | Şablonlar (ADMIN/PARTNER) |
| POST | /api/v1/workflow-templates/:id/steps | Adım tanımı |
| POST | /api/v1/cases/:id/workflows | Şablonu dosyada tetikle `{template_id, anchor_deadline_id, role_assignments}` |
| GET | /api/v1/workflow-runs/:id | Zincir durumu (adım/görev haritası) |
| POST | /api/v1/workflow-runs/:id/cancel | Zinciri iptal et |

## Diğer Modüllerle İlişkiler

- **02 Dava**: görevler dosyanın Görevler sekmesinde; aşama geçişleri (stage→APPEAL) şablon tetikleyebilir; görev olayları safahata düşer.
- **03 Duruşma**: duruşma hazırlık görevleri şablondan açılabilir; sonuç girilince kapanır.
- **04 Süre**: `deadline_id` bağı ve çapadan geri hesap; süre DONE'u görevle otomatikleşmez (Modül 04 kural 10).
- **05 İcra**: ENF_NEXT_ACTIONS önerileri TASK_SUGGEST onay akışından görevleşir.
- **06 Belge**: pipeline CREATE_TASKS adımı, onaylanan proposal aksiyonlarını `source=PIPELINE` göreviyle açar.
- **19 Dashboard**: "AÇIK GÖREV 126" ve "müdahale etmem gereken 10 şey" listesi bu modülden beslenir.

## Kabul Kriterleri

1. approval_required görev; TODO→IN_PROGRESS→IN_REVIEW→APPROVED→DONE zincirini tamamlıyor, her geçiş TaskStatusLog'da aktörüyle görünüyor.
2. IN_REVIEW'dan gerekçesiz REJECTED denemesi 422; gerekçeli ret görevi IN_PROGRESS'e döndürüyor ve sorumluya bildirim gidiyor.
3. STAJYER rolüyle POST /tasks 403 döndürüyor; kendine atanan görevde transition çalışıyor.
4. Sorumlu=kontrol eden aynı kişiyle görev açma 422.
5. İstinaf şablonu tetiklendiğinde 5 görev; bağımlılık, rol çözümü ve çapadan hesaplanmış son tarihlerle oluşuyor; adım 3, adım 1-2 DONE olmadan IN_PROGRESS'e alınamıyor.
6. Çapa Deadline tarihi düzeltilince zincirdeki açık görevlerin son tarihleri yeniden hesaplanıyor.
7. Deadline'a bağlı görevde son gün−1 tarihli due_date girişi uyarı üretiyor ve Partner bildirimi düşüyor.
8. Son tarihi 48 saat geçmiş görevde Partner eskalasyon bildirimi oluşuyor (zamanlanmış iş testi).
9. Workflow iptali zincirin açık görevlerini CANCELLED yapıyor, DONE olanlara dokunmuyor.
10. Onaylanmamış TASK_SUGGEST önerisi hiçbir Task kaydı üretmiyor.
11. Workload matrisi kişi başına açık/gecikmiş/tamamlanan sayılarını doğru döndürüyor.

## Faz

**Faz 1**: Task durum makinesi, rol yetki matrisi, onay akışı, eskalasyon, ekranlar ve istinaf seed şablonu. **Faz 2**: şablon editörünün görsel tasarımcısı, otomatik tetikler (STAGE_CHANGE/DOCUMENT_CLASS) ve TASK_SUGGEST/WORKLOAD_SUMMARY AI görevleri.
