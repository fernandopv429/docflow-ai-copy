import { base44 } from '@/api/base44Client';

// Content larger than this is stored as a hosted file instead of inline in the DB
const MAX_INLINE_SIZE = 50000;

// Returns { content, content_url } ready to save on the Template entity
export async function packTemplateContent(html) {
  if (!html || html.length <= MAX_INLINE_SIZE) {
    return { content: html || '', content_url: '' };
  }
  const file = new File([html], 'template-content.html', { type: 'text/html' });
  const { file_url } = await base44.integrations.Core.UploadFile({ file });
  return { content: '', content_url: file_url };
}

// Returns the full HTML content of a template (fetches hosted file if needed)
export async function loadTemplateContent(template) {
  if (template?.content_url) {
    const res = await fetch(template.content_url);
    return await res.text();
  }
  return template?.content || '';
}