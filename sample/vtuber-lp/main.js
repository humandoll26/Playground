// CSS is now loaded via index.html link tag for GitHub Pages compatibility

document.addEventListener('DOMContentLoaded', () => {
  // Mobile Menu Toggle
  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.getElementById('navLinks');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('active');
    });
  }

  // Close mobile menu when clicking a link
  const links = document.querySelectorAll('.nav-link');
  links.forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('active');
    });
  });

  // Intersection Observer for scroll animations (fade in content)
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.15
  };

  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  const elementsToAnimate = document.querySelectorAll('.auto-show');
  elementsToAnimate.forEach(el => {
    observer.observe(el);
  });

  // Glitch effect on title hover (optional logic if we want to randomize text)
  const glitchText = document.querySelector('.glitch');
  if (glitchText) {
    // We handle mostly through CSS, but JS could be used to sporadically trigger animations
  }

  // Smooth blur effect on scroll for navbar
  const nav = document.querySelector('.glass-nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      nav.style.background = 'rgba(8, 8, 12, 0.85)';
      nav.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.5)';
    } else {
      nav.style.background = 'rgba(8, 8, 12, 0.7)';
      nav.style.boxShadow = 'none';
    }
  });
});
