import Link from "next/link";

/**
 * NomosOS pazarlama sayfası (halka açık SaaS vitrini).
 * Hedef kitle: binlerce avukat ve hukuk bürosu — docs/99-kaynak-gereksinimler.md temel alınmıştır.
 */

const NAV_LINKS = [
  { href: "#neden", label: "Neden NomosOS" },
  { href: "#moduller", label: "Modüller" },
  { href: "#nasil-calisir", label: "Nasıl Çalışır" },
  { href: "#byo-llm", label: "Kendi LLM'iniz" },
  { href: "#fiyatlandirma", label: "Fiyatlandırma" },
  { href: "#sss", label: "SSS" },
];

const VALUE_CARDS = [
  {
    icon: "⏰",
    title: "Hiçbir süreyi kaçırmayın",
    text: "İstinaf, cevap, itiraz… Hukukta bir günlük gecikme davayı kaybettirir. NomosOS süreleri deterministik kural motoruyla hesaplar, AI tebligatlardan yeni süreleri tespit eder, siz yalnızca onaylarsınız.",
  },
  {
    icon: "🧠",
    title: "Dosyanız her şeyi bilir",
    text: "Taraflar, safahat, duruşmalar, deliller, bilirkişi raporları, finans — hepsi tek dosyada birleşir. Dosyaya soru sorun: AI, dosyanın tamamını bilerek cevap verir; genel bir sohbet robotu değildir.",
  },
  {
    icon: "🔒",
    title: "Verileriniz sizde kalır",
    text: "KVKK sistem seviyesinde: kişisel veriler AI'a gitmeden otomatik tespit edilir ve maskelenir. Dilerseniz Ollama ile yerel model bağlarsınız — dosyalarınız büronuzdan tek bayt dışarı çıkmaz.",
  },
];

const MODULES = [
  {
    icon: "👥",
    title: "Müvekkil CRM",
    text: "Müvekkil tek dosya değildir: 37 dava, 82 icra, 6 sözleşme tek karttan görünür. İletişim geçmişi, vekaletnameler, finansal hareketler ve tüm dosyalar müvekkil merkezli tek bakışta.",
  },
  {
    icon: "⚖️",
    title: "Dava Yönetimi",
    text: "Açılıştan istinaf, temyiz ve icraya kadar tam yaşam döngüsü. Taraflar, safahat, deliller, kararlar ve harçlar tek dosya ekranında; hiçbir aşama sistem dışında kalmaz.",
  },
  {
    icon: "📅",
    title: "Duruşma & Süre Takibi",
    text: '"Bugün hangi duruşmalarım var?" sorusuna tek ekranda cevap. AI duruşma hazırlık paketi üretir: son gelişmeler, karşı beyanlar, sorulacak sorular ve eksik deliller hazır gelir.',
  },
  {
    icon: "🏛️",
    title: "İcra + AI Copilot",
    text: "İlamlı/ilamsız takipler ayrı bir ana modülde. AI Copilot borçlu malvarlığını analiz eder, haciz aşamasındaki seçenekleri sıralar ve dosya bazında tahsilat ihtimalini değerlendirir.",
  },
  {
    icon: "📄",
    title: "Belge → Otomatik Aksiyon",
    text: 'Yeni paradigma: "Belge geldi, sistem ne yapılacağını çıkardı." Ara karar geldiğinde görev açılır, süre oluşur, sorumlu atanır, müvekkil bilgilendirme taslağı hazırlanır — siz onaylarsınız.',
  },
  {
    icon: "✅",
    title: "Görev & Workflow",
    text: "Dosya → görev → sorumlu → kontrol → onay zinciri. Stajyer araştırır, avukat yazar, partner onaylar, sekreter UYAP'a gönderir; kim neyi ne zamana yetiştirecek hep bellidir.",
  },
  {
    icon: "💰",
    title: "Finans & Faturalama",
    text: '"ABC Holding\'in bize toplam borcu ne?" — tahakkuk, tahsilat, avans, masraf ve harç dosya ve müvekkil bazında anında. E-Fatura/e-Arşiv entegrasyonu ile ödeme takibi tamamlanır.',
  },
  {
    icon: "🎯",
    title: "Strateji & Risk Motoru",
    text: "Argüman-delil-dayanak matrisi kurar; dosyayı karşı taraf avukatı veya hakim gözüyle simüle eder. Her dosyada süre, delil, tahsilat ve usul riskleri skorlanır: riskli 17 dosyanız sabah masanızdadır.",
  },
  {
    icon: "🤝",
    title: "Müvekkil Portalı",
    text: '"Davam ne oldu?" telefonları biter. Müvekkil kendi portalından dosyalarını, duruşmalarını ve ödemelerini görür; AI\'ın hazırladığı anlaşılır durum özetleri tek tıkla paylaşılır.',
  },
  {
    icon: "🔗",
    title: "UYAP Entegrasyonu",
    text: "UYAP'tan dosya, safahat, duruşma ve evrak senkronizasyonu. Gelen her evrak otomatik sınıflanır, dosyasına bağlanır, süresi tespit edilir. NomosOS, UYAP'ın üzerine kurulan AI operasyon katmanıdır.",
  },
];

const STEPS = [
  {
    no: "1",
    title: "UYAP'tan senkronla",
    text: "Dosyalarınız, safahat ve yeni evraklar UYAP'tan NomosOS'a akar. Elle veri girişiyle vakit kaybetmezsiniz.",
  },
  {
    no: "2",
    title: "AI sınıflandırsın",
    text: "Gelen her belge otomatik sınıflanır: tebligat mı, ara karar mı, bilirkişi raporu mu? İçerik yapılandırılmış veriye dönüşür.",
  },
  {
    no: "3",
    title: "Süre ve görev otomatik",
    text: "Belgeden tespit edilen süreler kural motoruyla hesaplanır, ilgili görevler açılır ve sorumlu avukata atanır.",
  },
  {
    no: "4",
    title: "Siz onaylayın",
    text: "AI hiçbir zaman son sözü söylemez. Her süre önerisi ve otomatik aksiyon, avukat onayından geçerek kesinleşir.",
  },
];

const LLM_PROVIDERS = [
  { name: "Anthropic", note: "Claude modelleri" },
  { name: "OpenAI", note: "+ Azure, OpenRouter, Groq, vLLM gibi uyumlu endpoint'ler" },
  { name: "Google Gemini", note: "Gemini model ailesi" },
  { name: "Ollama", note: "Tamamen yerel — veri dışarı çıkmaz" },
  { name: "Özel Endpoint", note: "Kendi header ve alan eşlemenizle kurum içi model" },
];

const PLANS = [
  {
    name: "Solo",
    subtitle: "Bağımsız çalışan avukatlar için",
    price: "Yakında",
    highlight: false,
    features: [
      "1 kullanıcı",
      "Sınırsız dosya ve müvekkil",
      "Duruşma ve süre takibi",
      "AI dosya asistanı (kendi API anahtarınızla)",
      "Belge sınıflandırma",
      "E-posta desteği",
    ],
  },
  {
    name: "Büro",
    subtitle: "Küçük ve orta ölçekli bürolar için",
    price: "Yakında",
    highlight: true,
    features: [
      "Sınırsız kullanıcı, rol bazlı yetki",
      "Görev & workflow zinciri (onay akışları)",
      "Belge → otomatik aksiyon hattı",
      "İcra AI Copilot",
      "Finans, faturalama ve müvekkil portalı",
      "UYAP senkronizasyonu",
      "Öncelikli destek",
    ],
  },
  {
    name: "Enterprise",
    subtitle: "Kurumsal bürolar ve hukuk departmanları",
    price: "Yakında",
    highlight: false,
    features: [
      "Büro planındaki her şey",
      "Private AI: yerel LLM / Türkiye veri bölgesi",
      "Strateji & Risk Motoru, simülasyon modları",
      "Conflict check (çıkar çatışması taraması)",
      "SSO ve gelişmiş denetim kayıtları",
      "Özel kurulum (on-premise seçeneği) ve SLA",
    ],
  },
];

const FAQ = [
  {
    q: "NomosOS bir 'AI sohbet robotu' mu?",
    a: "Hayır. NomosOS bir hukuk bürosu işletim sistemidir: müvekkil, dosya, duruşma, süre, icra, görev ve finans yönetimi çekirdektir. AI bu operasyonel verinin üzerinde çalışan zekâ katmanıdır — dosyanızı bilerek cevap verir, belgeden süre tespit eder, duruşma paketi hazırlar.",
  },
  {
    q: "Verilerimiz yurt dışına çıkıyor mu? KVKK'ya uyum nasıl sağlanıyor?",
    a: "Maskeleme kullanıcıya bırakılmaz, sistem seviyesinde çözülür: TC kimlik no, telefon, adres, IBAN ve e-posta gibi kişisel veriler AI'a gönderilmeden önce otomatik tespit edilir; maskeli hali size gösterilir ve onayınızla gönderilir. Dilerseniz Ollama ile yerel model veya kurum içi özel endpoint bağlarsınız — bu durumda veri büronuzdan hiç çıkmaz.",
  },
  {
    q: "Kendi LLM hesabımızı kullanabilir miyiz?",
    a: "Evet, NomosOS BYO-LLM mimarisiyle kuruludur. Anthropic, OpenAI ve OpenAI-uyumlu servisler, Google Gemini, Ollama veya tamamen özel bir endpoint bağlayabilir; hatta görev tipine göre farklı model seçebilirsiniz (örneğin dilekçe taslağı güçlü bir modelle, belge sınıflandırma ucuz bir modelle).",
  },
  {
    q: "Süre hesaplarında AI'a güvenmek riskli değil mi?",
    a: "Bu yüzden hibrit çalışırız: kesin hukuki süreler mevzuat, tebliğ tarihi, tebliğ yöntemi ve resmi tatiller dikkate alınarak deterministik kural motoruyla hesaplanır. AI yalnızca belgelerden süre 'tespit ve öneri' yapar; hiçbir AI önerisi avukat onayı olmadan kesinleşmez.",
  },
  {
    q: "UYAP entegrasyonu nasıl çalışıyor?",
    a: "Hedefimiz UYAP'ın yerine geçmek değil, üzerine bir AI operasyon katmanı koymak. Dosyalar, safahat, duruşmalar ve evraklar senkronize edilir; gelen evrak otomatik sınıflanır, dosyasına bağlanır, süresi çıkarılır ve görevi açılır. Mümkün olan işlemlerde iki yönlü akış hedeflenir.",
  },
  {
    q: "Mevcut dosyalarımızı taşımak zor olur mu?",
    a: "Kurulumda UYAP senkronizasyonu ve toplu içe aktarma ile mevcut dosya ve müvekkil portföyünüz sisteme alınır. Büro planında ekibimiz geçiş sürecinde birlikte çalışır; Excel/CSV listeleriniz de içe aktarılabilir.",
  },
];

function SectionTitle({
  kicker,
  title,
  lead,
}: {
  kicker: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-amber-600">
        {kicker}
      </p>
      <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {lead && <p className="mt-4 text-base leading-7 text-slate-600">{lead}</p>}
    </div>
  );
}

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <rect width="32" height="32" rx="7" className={dark ? "fill-amber-500" : "fill-slate-900"} />
        <path
          d="M16 6l2.1 4.6 4.9.6-3.6 3.4.9 4.9L16 17l-4.3 2.5.9-4.9L9 11.2l4.9-.6L16 6z"
          className={dark ? "fill-slate-900" : "fill-amber-400"}
        />
        <rect x="8" y="23" width="16" height="2.5" rx="1.25" className={dark ? "fill-slate-900" : "fill-white"} />
      </svg>
      <span className={`text-xl font-bold tracking-tight ${dark ? "text-white" : "text-slate-900"}`}>
        Nomos<span className="text-amber-500">OS</span>
      </span>
    </span>
  );
}

export default function MarketingPage() {
  return (
    <div className="bg-white">
      {/* ---------- Üst navigasyon ---------- */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="NomosOS ana sayfa">
            <Logo dark />
          </Link>
          <nav className="hidden items-center gap-6 lg:flex" aria-label="Bölümler">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm text-slate-300 transition-colors hover:text-amber-400"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/giris"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 hover:text-white"
            >
              Giriş Yap
            </Link>
            <a
              href="#fiyatlandirma"
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-400"
            >
              Demo Talep Et
            </a>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden bg-slate-900">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, #f59e0b 0, transparent 40%), radial-gradient(circle at 80% 70%, #1d4ed8 0, transparent 45%)",
          }}
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-24 text-center sm:px-6 sm:py-32">
          <p className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/70 px-4 py-1.5 text-xs font-medium text-amber-400">
            AI-Native Legal Operating System — Türk hukuk büroları için
          </p>
          <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Hukuk Büronuzun <span className="text-amber-400">İşletim Sistemi</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            AI destekli dosya, müvekkil, duruşma, süre, icra ve finans yönetimi — tek platform.
            Merkezde AI değil, <strong className="text-white">dosyanız</strong> var; AI ise tüm
            operasyonunuzun üzerinde çalışan zekâ katmanı.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href="#fiyatlandirma"
              className="rounded-md bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-900 shadow-lg transition-colors hover:bg-amber-400"
            >
              Demo Talep Et
            </a>
            <a
              href="#moduller"
              className="rounded-md border border-slate-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-amber-400 hover:text-amber-400"
            >
              Modülleri İncele
            </a>
          </div>
          <dl className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-6 text-center sm:grid-cols-4">
            {[
              ["21", "gereksinimden doğan modül"],
              ["5", "farklı LLM sağlayıcı tipi"],
              ["%100", "avukat onaylı AI aksiyonu"],
              ["0", "kaçırılan süre hedefi"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-800/50 p-4">
                <dt className="order-last mt-1 text-xs text-slate-400">{label}</dt>
                <dd className="text-2xl font-bold text-amber-400">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---------- Neden NomosOS ---------- */}
      <section id="neden" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6">
        <SectionTitle
          kicker="Neden NomosOS"
          title="Bir asistan değil, büronun tamamı"
          lead="AI asistanlar dilekçe yazar. NomosOS ise büronuzun bütün operasyonunu yönetir — ve o operasyonun üzerine AI koyar."
        />
        <div className="grid gap-8 md:grid-cols-3">
          {VALUE_CARDS.map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-2xl">
                <span aria-hidden="true">{card.icon}</span>
              </div>
              <h3 className="mb-3 text-lg font-semibold text-slate-900">{card.title}</h3>
              <p className="text-sm leading-6 text-slate-600">{card.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Modül turu ---------- */}
      <section id="moduller" className="scroll-mt-20 bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionTitle
            kicker="Modül Turu"
            title="Açılıştan tahsilata, tek platform"
            lead="Dava yaşam döngüsünün her aşaması için ayrı bir modül; hepsi aynı dosya çekirdeğinin üzerinde çalışır."
          />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {MODULES.map((m) => (
              <div
                key={m.title}
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <span className="mb-3 text-2xl" aria-hidden="true">
                  {m.icon}
                </span>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">{m.title}</h3>
                <p className="text-xs leading-5 text-slate-600">{m.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Nasıl çalışır ---------- */}
      <section id="nasil-calisir" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6">
        <SectionTitle
          kicker="Nasıl Çalışır"
          title="Evrak geldiğinde büro kendiliğinden çalışır"
          lead="Belge yükleyip 'analiz et' demek eski paradigma. NomosOS'ta sistem, ne yapılması gerektiğini kendisi çıkarır — son söz her zaman avukatta."
        />
        <ol className="grid gap-6 md:grid-cols-4">
          {STEPS.map((step) => (
            <li key={step.no} className="relative rounded-xl border border-slate-200 bg-white p-6">
              <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-base font-bold text-slate-900">
                {step.no}
              </span>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">{step.title}</h3>
              <p className="text-xs leading-5 text-slate-600">{step.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 overflow-x-auto rounded-xl border border-slate-200 bg-slate-900 p-6">
          <pre className="whitespace-pre text-xs leading-6 text-slate-300">
{`BELGE ANALİZİ : Bu belge ara karardır.
TESPİTLER     : Bilirkişi raporu talep edilmiş · 2 haftalık süre verilmiş · X belgesi istenmiş.
AKSİYONLAR    : ☑ Görev oluştur   ☑ Son tarih oluştur   ☑ Sorumlu avukata ata
                ☑ Müvekkil bilgilendirme taslağı   ☑ Duruşma hazırlığını güncelle`}
          </pre>
          <p className="mt-3 text-xs text-amber-400">
            Örnek: mahkemeden ara karar geldiğinde NomosOS'un otomatik ürettiği aksiyon planı.
          </p>
        </div>
      </section>

      {/* ---------- BYO-LLM ---------- */}
      <section id="byo-llm" className="scroll-mt-20 bg-slate-900 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-amber-400">
                BYO-LLM
              </p>
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Kendi LLM'inizi bağlayın
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-300">
                Her büronun gizlilik politikası, bütçesi ve model tercihi farklıdır. NomosOS sizi
                tek bir yapay zekâ sağlayıcısına kilitlemez: kendi API anahtarınızla dilediğiniz
                modeli bağlar, hatta görev tipine göre farklı modeller seçersiniz.
              </p>
              <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
                <p className="text-sm leading-6 text-amber-200">
                  <strong className="text-amber-400">KVKK güvencesi:</strong> Dilerseniz yerel model
                  kullanın, verileriniz büronuzdan çıkmasın. Ollama veya kurum içi özel endpoint
                  seçtiğinizde hiçbir dosya içeriği dış servise gönderilmez. Dış model
                  kullanıldığında ise kişisel veriler otomatik tespit edilir, maskelenir ve yalnızca
                  sizin onayınızla gönderilir.
                </p>
              </div>
            </div>
            <ul className="space-y-3">
              {LLM_PROVIDERS.map((p) => (
                <li
                  key={p.name}
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-800/60 px-5 py-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.note}</p>
                  </div>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0 text-amber-400">
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.8a1 1 0 0 1 1.4 0Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------- Fiyatlandırma ---------- */}
      <section id="fiyatlandirma" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6">
        <SectionTitle
          kicker="Fiyatlandırma"
          title="Büronuzun ölçeğine göre"
          lead="Fiyatlar lansmanla birlikte açıklanacak. Erken erişim listesine katılan bürolara özel koşullar sunuyoruz."
        />
        <div className="grid gap-8 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border p-8 ${
                plan.highlight
                  ? "border-amber-500 bg-slate-900 shadow-xl"
                  : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1 text-xs font-bold text-slate-900">
                  En çok tercih edilecek
                </span>
              )}
              <h3
                className={`text-lg font-semibold ${plan.highlight ? "text-white" : "text-slate-900"}`}
              >
                {plan.name}
              </h3>
              <p className={`mt-1 text-xs ${plan.highlight ? "text-slate-400" : "text-slate-500"}`}>
                {plan.subtitle}
              </p>
              <p
                className={`mt-6 text-3xl font-bold ${plan.highlight ? "text-amber-400" : "text-slate-900"}`}
              >
                {plan.price}
              </p>
              <ul className="mt-6 flex-1 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className={`mt-0.5 h-4 w-4 shrink-0 ${plan.highlight ? "text-amber-400" : "text-amber-600"}`}
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.8a1 1 0 0 1 1.4 0Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className={plan.highlight ? "text-slate-300" : "text-slate-600"}>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href="mailto:demo@nomosos.com?subject=NomosOS%20Demo%20Talebi"
                className={`mt-8 rounded-md px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                  plan.highlight
                    ? "bg-amber-500 text-slate-900 hover:bg-amber-400"
                    : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                Demo Talep Et
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- SSS ---------- */}
      <section id="sss" className="scroll-mt-20 bg-slate-50 py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <SectionTitle kicker="SSS" title="Sık sorulan sorular" />
          <div className="space-y-4">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group rounded-xl border border-slate-200 bg-white p-5 open:shadow-md"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-slate-900">
                  {item.q}
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-5 w-5 shrink-0 text-amber-500 transition-transform group-open:rotate-180"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </summary>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="border-t border-slate-800 bg-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div>
              <Logo dark />
              <p className="mt-3 max-w-sm text-sm text-slate-400">
                AI-Native Legal Operating System. Türk hukuk büroları için dosya merkezli,
                KVKK-öncelikli tek platform.
              </p>
            </div>
            <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm" aria-label="Alt bağlantılar">
              {NAV_LINKS.map((l) => (
                <a key={l.href} href={l.href} className="text-slate-400 hover:text-amber-400">
                  {l.label}
                </a>
              ))}
              <Link href="/giris" className="text-slate-400 hover:text-amber-400">
                Giriş Yap
              </Link>
            </nav>
          </div>
          <p className="mt-10 border-t border-slate-800 pt-6 text-xs text-slate-500">
            © {new Date().getFullYear()} NomosOS. Tüm hakları saklıdır. NomosOS hukuki danışmanlık
            hizmeti vermez; nihai hukuki değerlendirme her zaman avukata aittir.
          </p>
        </div>
      </footer>
    </div>
  );
}
