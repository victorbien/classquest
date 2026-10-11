// Mobile navigation toggle
(function () {
  const toggle = document.getElementById('navToggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('backdrop');

  function openNav() {
    sidebar.classList.add('open');
    backdrop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closeNav() {
    sidebar.classList.remove('open');
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      sidebar.classList.contains('open') ? closeNav() : openNav();
    });
  }
  if (backdrop) backdrop.addEventListener('click', closeNav);

  // Close the menu after choosing a link (mobile)
  sidebar.querySelectorAll('.toc a').forEach(function (link) {
    link.addEventListener('click', function () {
      if (window.matchMedia('(max-width: 900px)').matches) closeNav();
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeNav();
  });
})();

// Highlight the current section in the sidebar as you scroll
(function () {
  const links = Array.from(document.querySelectorAll('.toc a'));
  const map = new Map();
  links.forEach(function (link) {
    const id = link.getAttribute('href').slice(1);
    const section = document.getElementById(id);
    if (section) map.set(section, link);
  });

  if (!('IntersectionObserver' in window) || map.size === 0) return;

  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        links.forEach(function (l) { l.classList.remove('active'); });
        const link = map.get(entry.target);
        if (link) link.classList.add('active');
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });

  map.forEach(function (_link, section) { observer.observe(section); });
})();
