import React from 'react';
import { Image } from '@/components/ui/image';
import { TIMBRADO } from '@/lib/timbrado';

const LOGO_URL = 'https://media.base44.com/images/public/6a5a44d24aa52c9fbdd61b1a/4f1847ac3_image.png';

function Header() {
  return (
    <header className="mb-8 border-b border-foreground pb-3 text-center">
      <Image src={LOGO_URL} alt="Fernando Vieira Advogados" fittingType="fit" className="mx-auto h-11 w-[220px]" />
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-10 border-t border-muted-foreground pt-2 text-center text-[10px] text-muted-foreground">
      {TIMBRADO.rodape.email} &nbsp;|&nbsp; {TIMBRADO.rodape.oab}
    </footer>
  );
}

export default function DocumentReviewPreview({ html, dimmed }) {
  const hasImportedPages = /class=["'][^"']*\bdocx\b/.test(html || '');
  if (hasImportedPages) {
    return <div className={`legal-document-review transition-opacity ${dimmed ? 'opacity-40' : 'opacity-100'}`} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div className={`legal-document-page mx-auto max-w-3xl bg-card text-card-foreground shadow-sm transition-opacity ${dimmed ? 'opacity-40' : 'opacity-100'}`}>
      <Header />
      <div className="legal-document-body" dangerouslySetInnerHTML={{ __html: html }} />
      <Footer />
    </div>
  );
}