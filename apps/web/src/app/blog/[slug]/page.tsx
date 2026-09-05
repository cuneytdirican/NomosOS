import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Container, Section, SectionHeading } from "@/components/marketing/primitives";
import { Markdown } from "@/components/marketing/Markdown";
import { blogPosts, findPost } from "@/components/marketing/blog-content";

export function generateStaticParams() {
  return blogPosts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) return { title: "Yazı bulunamadı" };
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: "article", title: post.title, description: post.excerpt, publishedTime: post.date, authors: [post.author] },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) notFound();
  return (
    <MarketingShell>
      <Section>
        <Container>
          <p className="text-sm">
            <Link href="/blog" className="text-[var(--ink-soft)] hover:text-[#7a6220]">
              ← Blog
            </Link>
          </p>
          <SectionHeading kicker={post.tags.join(" · ").toLocaleUpperCase("tr-TR")} title={post.title} lead={post.excerpt} />
          <p className="tnum mt-4 text-sm text-[var(--ink-soft)]">
            {new Date(post.date).toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" })} · {post.author}
          </p>
          <article className="mt-10 max-w-[70ch]">
            <Markdown source={post.body} />
          </article>
          <p className="mt-12 rounded-[5px] border border-[var(--rule)] bg-[var(--paper-alt)] p-4 text-xs text-[var(--ink-soft)]">
            Bu yazı genel bilgilendirme amaçlıdır; hukuki tavsiye değildir. Somut olayda süre ve usul, dosyanın avukatı tarafından değerlendirilir.
          </p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
