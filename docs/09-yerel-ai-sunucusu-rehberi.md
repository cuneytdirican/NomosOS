# NomosOS — Yerel AI Sunucusu Tercih Rehberi

> Bu doküman, NomosOS'u **kendi altyapınızdaki bir model sunucusuyla** çalıştırmak
> istediğinizde ne seçeceğinizi anlatır. İlgili dokümanlar:
> [03-ai-katmani-byo-llm.md](03-ai-katmani-byo-llm.md) (mimari),
> [04-kvkk-veri-guvenligi.md](04-kvkk-veri-guvenligi.md) (veri ilkeleri),
> [moduller/26-ai-kota-kredi-sistemi.md](moduller/26-ai-kota-kredi-sistemi.md) (maliyet).
>
> ⚠️ **Model dünyası hızlı değişiyor.** Bu rehberdeki **karar çerçevesi** kalıcıdır; model
> adları ve sürüm numaraları eskiyecektir. Satın alma/kurulum kararı vermeden önce
> adı geçen model ailelerinin güncel sürümlerini doğrulayın.

---

## 1. Önce Şunu Netleştirin: Neden Yerel?

Yerel sunucunun üç meşru gerekçesi vardır. Hangisi sizin için geçerliyse tasarım da ona göre değişir:

| Gerekçe | Sonucu ne değiştirir |
|---|---|
| **KVKK / veri egemenliği** — müvekkil verisi büro ağından çıkmasın | Sunucu **özel ağda** olmalı; internete açık bir VPS'te barındırmak gerekçeyi ortadan kaldırır |
| **Maliyet** — yüksek hacimde token faturası | Yalnız **yüksek hacimli, kolay** görevleri yerele alın; zor görevler için hibrit kalın (§8) |
| **Bağımsızlık** — sağlayıcı kilidi olmasın | Zaten BYO-LLM mimarisi bunu veriyor; yerel sunucu ek bir güvence |

Gerekçeniz yalnızca "modern görünsün" ise **yerel sunucu kurmayın.** İşletim yükü (GPU, güncelleme, izleme, yedeklilik) gerçek ve süreklidir.

---

## 2. Çıkarım (Inference) Sunucusu Seçimi

NomosOS `OPENAI_COMPAT` adaptörünü kullanır: sunucunuz `POST /chat/completions` ve
`GET /models` uçlarını konuşuyorsa **kod tarafında hiçbir değişiklik gerekmez.**

| Sunucu | Ne zaman | Güçlü yanı | Zayıf yanı |
|---|---|---|---|
| **Ollama** | Tek makine, 1–10 kullanıcı, hızlı başlangıç | Kurulumu dakikalar sürer, model indirme tek komut, OpenAI-uyumlu uç var | Eşzamanlı istekte verim düşer; üretim ölçeğine uygun değil |
| **vLLM** | **Çok kullanıcılı büro / üretim — önerilen** | Sürekli yığınlama (continuous batching), yüksek verim, OpenAI-uyumlu sunucu, **kısıtlı kod çözme** desteği (§7) | Kurulum ve GPU ayarı daha zahmetli |
| **SGLang** | vLLM alternatifi, benzer sınıf | Bazı iş yüklerinde daha hızlı | Ekosistem daha küçük |
| **TGI** (HF) | Kurumsal, HuggingFace yığınında olanlar | Olgun, iyi belgelenmiş | Lisans ve yapılandırma ayrıntıları |
| **llama.cpp / llama-server** | GPU yoksa, küçük model, düşük hacim | CPU'da çalışır, çok düşük kaynak | Büyük modellerde kabul edilemez yavaş |

**Önerimiz:** Denemeye **Ollama** ile başlayın (bir akşamda ayağa kalkar), büro gerçekten
kullanmaya başlayınca **vLLM**'e geçin. NomosOS her ikisiyle de aynı şekilde çalışır;
yalnızca ayarlardaki `baseUrl` değişir.

### NomosOS ayarları

**Ayarlar → AI Sağlayıcı → Yeni Sağlayıcı:**

| Alan | Ollama | vLLM / TGI / SGLang |
|---|---|---|
| Tip | `OLLAMA` | `OPENAI_COMPAT` |
| Base URL | `http://10.0.0.5:11434` | `http://10.0.0.5:8000/v1` |
| API anahtarı | (boş) | vLLM'de `--api-key` verdiyseniz o değer |
| Varsayılan model | `qwen3:14b` gibi | sunucuda yüklü model adı |

> **Adres önemli:** `isExternalDestination` kararı sağlayıcı *tipine* değil *adrese* bakar.
> Özel ağ adresi (RFC1918, `localhost`, `.local`) → **büro içi** sayılır, KVKK maskeleme
> onayı istenmez. Farklı bir iç ana makine adı kullanıyorsanız `AI_INTERNAL_HOSTS`
> değişkenine ekleyin. Adres çözülemezse sistem **fail-closed** davranır: dış sayar,
> maskeleme ister. Yanlış tarafta hata yapmaz.

---

## 3. Model Seçimi

### 3.1 Dürüst çerçeve

Türk hukukunda çalışacak bir model için üç ölçüt önemlidir, bu sırayla:

1. **Türkçe yeterliliği** — hukuki Türkçe, resmî üslup, uzun cümle yapısı
2. **Muhakeme derinliği** — argüman kurma, çelişki yakalama, senaryo üretme
3. **Talimat uyumu ve yapılandırılmış çıktı** — NomosOS her AI çıktısını bir şemayla
   doğrular; şemaya uymayan model, özelliği kullanılamaz hâle getirir

**Açık modeller 1. ve 3. ölçütte iyi durumda; 2. ölçütte hâlâ sınır sınıfı modellerin
gerisinde.** Bu, hukuk ürünü için önemlidir: strateji kurma ve karşı taraf simülasyonu
gibi görevlerde fark hissedilir. Bunu peşinen kabul edip görev dağılımını buna göre
yapmak (§6, §8), "her şeyi yerele alalım" demekten daha iyi sonuç verir.

### 3.2 Aday model aileleri

| Aile | Türkçe | Not |
|---|---|---|
| **Qwen** (Qwen2.5 / Qwen3) | İyi | Çok dilli eğitimi güçlü; 7B–72B aralığında geniş boy seçeneği; açık ağırlık. **Genel amaçlı ilk tercih adayı** |
| **Llama 3.x** | Orta | Yaygın araç desteği; Türkçesi Qwen'in gerisinde |
| **Mistral / Mixtral** | Orta | Avrupa dillerinde iyi; Türkçede değişken |
| **Gemma** | Orta | Küçük boylarda verimli |
| **DeepSeek V3 / R1** | İyi | Açık ağırlık ama **çok büyük** (MoE, yüzlerce milyar parametre) — pratikte kendi donanımınızda barındırmak zor |
| **Türkçe'ye özel ince ayarlı modeller** | Değişken | Türkiye'de üretilen Türkçe fine-tune'lar mevcut; genellikle daha küçük ve muhakemede zayıf. **Sınıflandırma/özetleme gibi dar görevlerde** değerlendirilebilir, strateji üretiminde değil |

> **Kendi ölçümünüzü yapın (§9).** Yukarıdaki tablo yön verir, karar vermez. Bir modelin
> genel kıyaslamalarda iyi olması, sizin dosya metinlerinizde iyi olacağı anlamına gelmez.

### 3.3 Bağlam penceresi — pazarlığa kapalı

NomosOS'un dosya bağlamı uzundur: dosya künyesi + taraflar + safahat + belge parçaları.
**En az 32k, tercihen 128k bağlam** hedefleyin. Kısa bağlamlı bir model, `case-context`
katmanının bağlamı agresif kırpmasına ve cevap kalitesinin düşmesine yol açar.

---

## 4. Gömme (Embedding) Modeli

RAG indeksleme ayrı bir modeldir ve **sohbet modelinden bağımsız seçilir.**

| Model | Not |
|---|---|
| **BGE-M3** | Çok dilli, uzun bağlam, Türkçede güçlü — **ilk tercih adayı** |
| **multilingual-e5-large** | Olgun, yaygın, iyi Türkçe |
| **jina-embeddings-v3** | Çok dilli, iyi sonuçlar |

Gömme modeli **küçüktür ve ucuzdur** — tek bir mütevazı GPU'da, hatta CPU'da çalışabilir.
Bu yüzden yerele almanın en kolay ve en kârlı parçası budur: belge içerikleri indekslenirken
hiç dışarı çıkmaz, üstelik NomosOS'ta gömme zaten **ücretsiz görev** listesindedir.

> **Kritik uyarı:** Gömme modelini sonradan değiştirirseniz **tüm `DocumentChunk`
> kayıtlarının yeniden indekslenmesi gerekir.** Farklı modellerin vektörleri
> karşılaştırılamaz. Modeli baştan doğru seçin; değiştirecekseniz yeniden indeksleme
> planlayın.

Ollama'da gömme desteklenir; vLLM'de ayrı bir gömme servisi (örn. `text-embeddings-inference`)
çalıştırmak genellikle daha temizdir.

---

## 5. Donanım Boyutlandırma

Kaba VRAM ihtiyacı (ağırlıklar için; bağlam ve yığınlama ek yer ister):

| Model boyu | fp16/bf16 | 4-bit nicemleme | Tipik donanım |
|---|---|---|---|
| 7–8B | ~16 GB | ~6 GB | Tek RTX 4090 (24 GB) — hatta 3090 |
| 14B | ~28 GB | ~10 GB | Tek 4090 (nicemli) veya A100 40 GB |
| 32B | ~64 GB | ~20 GB | A100 80 GB, veya 2× 4090 (nicemli) |
| 70B+ | ~140 GB | ~40 GB | 2× A100 80 GB, veya 2× 4090 (agresif nicemli, kalite düşer) |

**Pratik notlar:**

- **Nicemleme (quantization) bedava değildir.** 4-bit, uzun ve karmaşık hukuki muhakemede
  kaliteyi hissedilir biçimde düşürür. Sınıflandırma gibi kolay görevlerde fark azdır.
  Zor görevlerde 8-bit veya fp16 tercih edin.
- **Eşzamanlılık VRAM yer.** 5 avukat aynı anda kullanacaksa KV önbelleği için ciddi ek
  bellek gerekir; vLLM'in `--gpu-memory-utilization` ve `--max-model-len` ayarlarını
  bilinçli kurun.
- **Başlangıç önerisi:** Tek bir 24 GB GPU ile 14B sınıfı bir model + ayrı bir gömme
  modeli, 5–15 kişilik bir büro için makul bir başlangıçtır. Zor görevleri (§6) hibrit
  bırakın.
- **CPU-only** yalnızca gömme ve çok küçük sınıflandırma modelleri için gerçekçidir.

---

## 6. NomosOS Görev → Model Eşlemesi

NomosOS'ta **31 AI görev tipi** vardır ve ayarlardan her biri farklı modele yönlendirilebilir
(`AiTaskRoute`). Yerel sunucuda en verimli düzen şudur:

### 6.1 Asla modele gitmeyenler (hatırlatma)

Bunlar **deterministik kod** ile yapılır, model seçiminden etkilenmez:
süre hesabı · faiz ve bakiye hesabı · KDV ve fatura toplamı · atıf doğrulama (kayıt araması) ·
delil matrisi · risk bandı (kural tabanı) · rapor rakamları.
Modeliniz ne kadar zayıf olursa olsun bu sonuçlar bozulmaz.

### 6.2 Küçük model yeterli (7–14B) — yüksek hacim, düşük zorluk

`DOCUMENT_CLASSIFY` · `DOCUMENT_EXTRACT` · `DEADLINE_DETECT` (yalnız tespit) ·
`EMBEDDING` · `MESSAGE_CASE_MATCH` · `SMART_NOTE` · `CLIENT_STATUS_SUMMARY` ·
`CASELAW_SUMMARIZE` · `OFFICE_QUERY` (sorgu planı üretir, veri görmez)

Bunlar belge hattının bel kemiğidir ve NomosOS'ta **ücretsiz** görevlerdir. Yerele almanın
en kârlı olduğu grup budur: hem hacim yüksek hem zorluk düşük.

### 6.3 Orta model (14–32B)

`CASE_CHAT` · `PETITION_SECTION_REWRITE` · `MESSAGE_DRAFT` · `HEARING_PREP` ·
`ENFORCEMENT_ANALYSIS` · `POA_SCOPE_ANALYSIS` · `EVIDENCE_MATRIX` · `EVIDENCE_GAP` ·
`REPORT_INTERPRET`

Kullanıcının doğrudan okuduğu metinler burada üretilir; Türkçe akıcılığı önemlidir.

### 6.4 En güçlü model (32B+ veya hibrit)

`STRATEGY_BUILD` · `OPPONENT_SIMULATION` · `JUDGE_SIMULATION` · `RISK_ASSESS` ·
`PETITION_DRAFT` · `CONTRACT_REVIEW` · `EXPERT_REPORT_DIFF` · `CASE_FULL_ANALYSIS` ·
`COLLECTION_LIKELIHOOD` · `CONFLICT_INFERENCE`

Muhakeme derinliği gerektiren, hata maliyeti yüksek görevler. **Açık modellerin en çok
zorlandığı grup burasıdır.** Yerel donanımınız güçlü değilse bu görevleri hibrit bırakın (§8).

---

## 7. Yapılandırılmış Çıktı — Gözden Kaçan Kritik Konu

NomosOS'ta neredeyse her AI görevinin bir **zod çıktı şeması** vardır ve `output-guard`
şemaya uymayan yanıtı reddeder. Küçük ve nicemlenmiş modeller geçerli JSON üretmekte
zorlanır; bu, "model iyi ama özellik çalışmıyor" tablosuna yol açar.

**Çözüm: kısıtlı kod çözme (constrained / guided decoding).** vLLM ve SGLang, çıktının bir
JSON şemasına veya dilbilgisine uymasını **üretim sırasında zorlar**:

```bash
# vLLM — yapılandırılmış çıktı desteğiyle
vllm serve <model> --host 0.0.0.0 --port 8000 \
    --max-model-len 32768 --guided-decoding-backend xgrammar
```

Bu, küçük modellerle bile şema uyumunu çarpıcı biçimde yükseltir ve **yerel sunucu
kurmanın en pratik kazancıdır.** Ollama'da JSON modu vardır ama tam şema zorlaması
sınırlıdır — bu, vLLM'e geçmenin somut bir gerekçesidir.

---

## 8. Hibrit Strateji (önerilen)

Hepsini yerele almak zorunda değilsiniz. `AiTaskRoute` tablosu görev başına farklı
sağlayıcıya izin verir:

```
Yerel sunucu (özel ağ)          Dış sağlayıcı (yalnız gerekirse)
├── Gömme / RAG indeksleme      └── Strateji, simülasyon, dilekçe taslağı
├── Belge sınıflandırma             (KVKK maskeleme hattı devrede, onay istenir)
├── Veri çıkarma, süre tespiti
├── Dosya sohbeti
└── Özetler, mesaj taslakları
```

Bu düzende **belge içerikleri hiç dışarı çıkmaz** (indeksleme ve sınıflandırma yerelde),
yalnızca zor muhakeme görevlerinde maskelenmiş bağlam dışarı gider — ve o da avukat
onayıyla.

Tamamen kapalı devre isterseniz dış sağlayıcıyı hiç tanımlamayın: NomosOS o görevlerde
anlamlı bir hata döner, sistem çökmez.

---

## 9. Nasıl Ölçersiniz? (bu adımı atlamayın)

Genel kıyaslamalar sizin dosyalarınızda ne olacağını söylemez. Küçük ama gerçek bir
değerlendirme seti kurun:

1. **Kapanmış dosyalarınızdan 30–50 örnek seçin** (kapanmış olması önemli: sonucu
   biliyorsunuz).
2. **Anonimleştirin** — ad, TCKN, adres, tutar değiştirin. Bu set eğitimde değil ölçümde
   kullanılacak ama yine de kişisel veri barındırmamalı.
3. Her örnek için **beklenen çıktıyı** bir avukat belirlesin: doğru belge sınıfı, doğru
   süre olayı tespiti, kabul edilebilir bir dilekçe bölümü.
4. Aday modelleri aynı setle çalıştırın ve **dört şeyi** ölçün:
   - **Doğruluk** (sınıflandırma/tespit doğru mu)
   - **Şema uyumu** (çıktı geçerli JSON mu — §7)
   - **Uydurma** (olmayan madde/içtihat üretiyor mu — NomosOS'un teyit katmanı yakalar ama
     sık uyduran model kullanılamaz)
   - **Gecikme** (avukat bekleyecek mi)
5. Sonuçları yazın ve **model değiştirdiğinizde tekrarlayın.**

> NomosOS'ta `AiUsageLog` her çağrının modelini, token sayısını ve süresini kaydeder;
> platform panelindeki kullanım analitiğinden gerçek kullanımdaki gecikme ve hacim
> verisini alabilirsiniz.

---

## 10. İşletim

| Konu | Ne yapmalı |
|---|---|
| **Sunucu düşerse** | NomosOS çökmez; ilgili AI görevi anlamlı Türkçe hata döner, dosya/süre/duruşma akışları çalışmaya devam eder. Yine de izleyin |
| **Zaman aşımı** | `AI_TIMEOUT_MS` (varsayılan 60000) — yerel sunucu yavaşsa yükseltin, ama avukatı 2 dakika bekletmeyin |
| **Eşzamanlılık** | vLLM'de `--max-num-seqs`; NomosOS'ta `AI_RATE_LIMIT_PER_MINUTE` ile büro tarafını da sınırlayın |
| **Model güncelleme** | Yeni sürüme geçmeden önce §9 setini tekrar koşturun. Sessiz kalite düşüşü en sinsi risktir |
| **Gömme modeli değişikliği** | Yeniden indeksleme gerekir (§4) |
| **Yedeklilik** | Tek GPU tek arıza noktasıdır. Kritik büroda ikinci bir sağlayıcıyı (dış API veya ikinci sunucu) yedek olarak tanımlı tutun |
| **Güvenlik** | Model sunucusu **yalnız iç ağdan** erişilebilir olsun; internete açmayın. vLLM'de `--api-key` kullanın |

---

## 11. Karar Özeti

| Senaryo | Çıkarım sunucusu | Sohbet modeli | Gömme | Donanım | Zor görevler |
|---|---|---|---|---|---|
| **Deneme / tek avukat** | Ollama | 7–14B (Qwen sınıfı) | BGE-M3 | Tek 24 GB GPU | Dış API (hibrit) |
| **Büro (5–20 kişi)** | **vLLM** + kısıtlı kod çözme | 14–32B | BGE-M3 (ayrı servis) | 1× A100 40/80 GB veya 2× 4090 | Hibrit önerilir |
| **Kurumsal / tam kapalı devre** | vLLM (yedekli) | 70B sınıfı | BGE-M3 | 2× A100 80 GB+ | Yerel — kalite kaybını §9 ile ölçün ve kabul edin |

**Her üç senaryoda da değişmeyen:** süre, para ve atıf doğrulama modele bırakılmaz;
AI çıktısı öneridir, avukat onaylar. Model seçimi bu ilkeleri gevşetmez.
