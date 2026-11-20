// Componentes pequenos compartilhados pelas telas do aplicativo.
export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const icon = (name, size = 20) => {
  const paths = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m15 18-6-6 6-6"/>', book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 16h16M8 7h8"/>',
    dice: '<path d="m12 3 9 5v8l-9 5-9-5V8z"/><path d="m3.3 8 8.7 5 8.7-5M12 13v8M8 5l8 5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>', close: '<path d="m18 6-12 12M6 6l12 12"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>', image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    bulb: '<path d="M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0c-.8.6-1 1.4-1 2H9c0-.6-.2-1.4-1-2Z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    spark: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1L19 14Z"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
};
export const initials = (name = '?') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
export const avatar = (name, url = '', sizeClass = '') => url ? `<img class="avatar ${sizeClass}" src="${url}" alt="Retrato de ${escapeHtml(name)}" />` : `<span class="avatar avatar-fallback ${sizeClass}">${escapeHtml(initials(name))}</span>`;
export const toast = (message) => {
  let node = document.querySelector('.toast');
  if (!node) { node = document.createElement('div'); node.className = 'toast'; document.body.append(node); }
  node.textContent = message;
  node.classList.add('toast-visible');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => node.classList.remove('toast-visible'), 2600);
};
