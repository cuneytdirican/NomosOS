import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Container, Section, SectionHeading } from "@/components/marketing/primitives";
import { blogPosts } from "@/components/marketing/blog-content";

export const metadata: Metadata = {
  title: "Blog",
  description: "Süre hesabı, KVKK ve yapay zekâ, UYAP köprüsü: hukuk bürolarının günlük işine dair kısa, kaynaklı yazılar.",
  alternates: { canonical: "/blog" },
};

export default function BlogPage() {
  const posts = [...blogPosts].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <MarketingShell>
      <Section>
        <Container>
          <SectionHeading kicker="BLOG" title="Büro pratiğine dair kısa yazılar." lead="Süre, tebligat, KVKK, UYAP ve yapay zekâ üzerine; kaynak gösteren, sonuç vaat etmeyen notlar." />
          <ul className="mt-12 grid gap-6 md:grid-cols-2">
            {posts.map((post) => (
              <li key={post.slug} className="rounded-[5px] border border-[var(--rule)] bg-white p-6">
                <p className="tnum text-xs text-[var(--ink-soft)]">
                  {new Date(post.date).toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" })} · {post.author}
                </p>
                <h2 className="serif mt-2 !text-[1.25rem]">
                  <Link href={`/blog/${post.slug}`} className="hover:text-[#7a6220]">
                    {post.title}
                  </Link>
                </h2>
                <p className="mt-3 text-[0.95rem] text-[var(--ink-soft)]">{post.excerpt}</p>
                <p className="mt-4 flex flex-wrap gap-2">
                  {post.tags.map((t) => (
                    <span key={t} className="rounded-full border border-[var(--rule)] px-2.5 py-0.5 text-[11px] text-[var(--ink-soft)]">
                      {t}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </Container>
      </Section>
    </MarketingShell>
  );
}
