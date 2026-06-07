// Vireo Landing — minimal interactions
// Smooth scroll, FAQ accordion handled by <details>, CTA analytics

document.addEventListener('DOMContentLoaded', () => {
  // Track CTA clicks for analytics
  const ctaButtons = document.querySelectorAll('a[href*="signup"]');
  ctaButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Could send to analytics endpoint
      if (window.console) console.log('[vireo] CTA click:', btn.textContent.trim());
    });
  });

  // Highlight nav link for current section on scroll
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  const sections = document.querySelectorAll('section[id]');
  if (navLinks.length && sections.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach(link => {
            const isActive = link.getAttribute('href') === `#${id}`;
            link.style.color = isActive ? 'var(--accent)' : '';
          });
        }
      });
    }, { threshold: 0.3 });
    sections.forEach(s => observer.observe(s));
  }
});
