// Shared behaviour for all pages: current year in the footer and
// keeping the active folder tab in view on small screens.
document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

const active = document.querySelector('.tabs .tab.active');
if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
