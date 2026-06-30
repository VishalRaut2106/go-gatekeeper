import scrollSvg from 'https://unpkg.com/scroll-svg@1.5.2';
import Lenis from 'https://cdn.jsdelivr.net/npm/@studio-freight/lenis@1.0.42/+esm';

document.addEventListener('DOMContentLoaded', () => {
    
    // === Initialize Lenis Smooth Scroll ===
    const lenis = new Lenis({
        duration: 1.4,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        smoothTouch: false
    });

    function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);
    
    // === GSAP Sequential Intro Timeline ===
    if (typeof gsap !== 'undefined' && document.querySelector('.home-page')) {
        gsap.registerPlugin(TextPlugin);

        // Extract and clear the text for typing effect
        const tHost1 = document.querySelector('.host-l1 .type-cmd');
        const tHost4 = document.querySelector('.host-l4 .type-cmd');
        const tHost5 = document.querySelector('.host-l5 .type-cmd');
        const tGuest1 = document.querySelector('.guest-l1 .type-cmd');
        const tGuest3 = document.querySelector('.guest-l3 .type-cmd');

        const textHost1 = tHost1 ? tHost1.textContent : "";
        const textHost4 = tHost4 ? tHost4.textContent : "";
        const textHost5 = tHost5 ? tHost5.textContent : "";
        const textGuest1 = tGuest1 ? tGuest1.textContent : "";
        const textGuest3 = tGuest3 ? tGuest3.textContent : "";

        document.querySelectorAll('.type-cmd').forEach(el => el.textContent = "");

        const tl = gsap.timeline();

        // Initial states
        tl.set(".blob-green-1", { width: "60px", height: "60px", borderRadius: "30px", opacity: 0, scale: 0 })
          .set(".blob-green-2", { width: "60px", height: "60px", borderRadius: "30px", opacity: 0, scale: 0 })
          .set(".terminal-text-line", { opacity: 0 });

        // 1. Initial UI entrance (Smooth pop from bottom)
        tl.from(".tilted-terminal, .hero-content, .floating-icon", { y: 120, opacity: 0, ease: "back.out(1.2)", duration: 1.2, stagger: 0.1 });
          
        tl.addLabel("parallelStart", "-=0.4"); // Start parallel animations slightly before pop finishes

        // 2. Box Morphing Timeline (Circle -> Tall -> Rectangle)
        const boxTl = gsap.timeline();
        boxTl.to(".blob-green-1, .blob-green-2", { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.5)" })
             .to(".blob-green-1", { height: "250px", duration: 0.5, ease: "power2.inOut" }, 0.4)
             .to(".blob-green-2", { height: "200px", duration: 0.5, ease: "power2.inOut" }, 0.4)
             .to(".blob-green-1", { width: "350px", borderRadius: "30px", duration: 0.8, ease: "power3.out" }, 0.9)
             .to(".blob-green-2", { width: "400px", borderRadius: "30px", duration: 0.8, ease: "power3.out" }, 0.9);

        // 3. Typing Sequence Timeline
        const typeTl = gsap.timeline();
        // Host starts session
        typeTl.to(".host-l1", { opacity: 1, duration: 0.1 })
              .to(".host-l1 .type-cmd", { text: textHost1, duration: 1, ease: "none" })
              .to(".host-l2", { opacity: 1, duration: 0.1 }, "+=0.2")
              // Guest connects
              .to(".guest-l1", { opacity: 1, duration: 0.1 }, "+=0.4")
              .to(".guest-l1 .type-cmd", { text: textGuest1, duration: 1.2, ease: "none" })
              .to(".guest-l2", { opacity: 1, duration: 0.1 }, "+=0.2")
              .to(".host-l3", { opacity: 1, duration: 0.1 }, "+=0.1") // Host sees connection
              // Guest runs command
              .to(".guest-l3", { opacity: 1, duration: 0.1 }, "+=0.6")
              .to(".guest-l3 .type-cmd", { text: textGuest3, duration: 0.6, ease: "none" })
              .to(".guest-l4", { opacity: 1, duration: 0.1 }, "+=0.1") // Guest gets blocked / waiting
              // Host intercepts
              .to(".host-l4", { opacity: 1, duration: 0.1 }, "+=0.2")
              .to(".host-l4 .type-cmd", { text: textHost4, duration: 0.6, ease: "none" }) // Host sees guest typing
              .to(".host-l5", { opacity: 1, duration: 0.1 }, "+=0.1") // Host sees approval prompt
              .to(".host-l5 .type-cmd", { text: textHost5, duration: 0.3, ease: "none" }, "+=0.5") // Approve!
              // Host approves and Guest executes
              .to(".guest-l5", { opacity: 1, duration: 0.1 }, "+=0.6");

        // Run them parallel!
        tl.add(boxTl, "parallelStart");
        tl.add(typeTl, "parallelStart");
    }

    // === Scroll SVG Animation ===
    const svgPath = document.querySelector('#scroll-line');
    if (svgPath) {
        scrollSvg(svgPath, { invert: false, draw_origin: 'center', speed: 1.2 });
    }

    // 1. Intersection Observer for Scroll Animations
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Optional: unobserve after fading in
                // observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

    // 2. Copy to Clipboard
    const copyButtons = document.querySelectorAll('.copy-btn');
    copyButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const textToCopy = btn.getAttribute('data-clipboard');
            if (!textToCopy) return;

            try {
                await navigator.clipboard.writeText(textToCopy);
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                btn.style.borderColor = '#68d391';
                btn.style.color = '#68d391';

                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.borderColor = '';
                    btn.style.color = '';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy', err);
            }
        });
    });

    // 3. GitHub API Release Fetcher (Only run if download buttons exist)
    const dlWin = document.getElementById('dl-win');
    if (dlWin) {
        const dlMac = document.getElementById('dl-mac');
        const dlLinux = document.getElementById('dl-linux');
        const versionTag = document.querySelector('.version-tag');
        const githubApiUrl = 'https://api.github.com/repos/VishalRaut2106/go-gatekeeper/releases/latest';

        fetch(githubApiUrl)
            .then(response => response.json())
            .then(data => {
                if (!data || !data.tag_name) {
                    throw new Error("Invalid response from GitHub API");
                }

                const version = data.tag_name; // e.g., "v2.0.2"
                versionTag.textContent = version;
                versionTag.classList.remove('loading');

                const changelogVer = document.querySelector('.changelog-version');
                if (changelogVer) {
                    changelogVer.textContent = version;
                }
                const cliVer = document.querySelector('.cli-version');
                if (cliVer) {
                    cliVer.textContent = version;
                }

                // Fallback direct source code download if assets are empty
                let winUrl = data.zipball_url;
                let macUrl = data.zipball_url;
                let linuxUrl = data.tarball_url;

                // Loop through assets to find specific OS builds
                data.assets.forEach(asset => {
                    const name = asset.name.toLowerCase();
                    if (name.includes('windows') || name.endsWith('.exe')) {
                        winUrl = asset.browser_download_url;
                    }
                    else if (name.includes('darwin') || name.includes('mac')) {
                        macUrl = asset.browser_download_url;
                    }
                    else if (name.includes('linux')) {
                        linuxUrl = asset.browser_download_url;
                    }
                });

                dlWin.href = winUrl;
                dlMac.href = macUrl;
                dlLinux.href = linuxUrl;

                // Optional: Update text to show direct OS mapping
                console.log(`Loaded Release: ${version}`);
            })
            .catch(error => {
                console.error('Error fetching latest release:', error);
                versionTag.textContent = "vLatest";
                versionTag.classList.remove('loading');
                
                // Fallback links just in case
                const fallbackUrl = "https://github.com/VishalRaut2106/go-gatekeeper/releases/latest";
                dlWin.href = fallbackUrl;
                dlMac.href = fallbackUrl;
                dlLinux.href = fallbackUrl;
            });
    }

     // === Two-Step Download Interception Flow ===
     const downloadGroup = document.querySelector('.download-section');
     if (downloadGroup) {
         const npxTip = document.createElement('div');
         npxTip.className = 'npx-tip';
         npxTip.style.cssText = `
             display: none;
             margin-top: 16px;
             padding: 16px;
             background: rgba(104, 211, 145, 0.08);
             border: 1px dashed rgba(104, 211, 145, 0.3);
             border-radius: 12px;
             font-size: 0.9rem;
             text-align: left;
             opacity: 0;
             transform: translateY(-10px);
             transition: opacity 0.3s ease, transform 0.3s ease;
         `;
         npxTip.innerHTML = `
             <span style="font-weight: 600; color: var(--brand-green); display: block; margin-bottom: 8px;">💡 Pro-Tip: Run instantly without installing!</span>
             <span style="color: var(--text-muted); font-size: 0.85rem;">You can execute Gatekeeper directly from your terminal:</span>
             <code class="terminal-code" style="display: flex; justify-content: space-between; align-items: center; background: #000; padding: 10px 14px; border-radius: 8px; font-family: var(--font-mono); color: #fff; margin-top: 8px; border: 1px solid #333; cursor: pointer; font-size: 0.9rem;" title="Click to Copy">
                 <span>npx gatekeeper-shell</span>
                 <span style="font-size: 0.75rem; color: var(--brand-green); font-weight: 600;">Copy</span>
             </code>
         `;
         downloadGroup.appendChild(npxTip);

         // Click to copy logic inside tip
         const codeBlock = npxTip.querySelector('code');
         codeBlock.addEventListener('click', () => {
             navigator.clipboard.writeText('npx gatekeeper-shell').then(() => {
                 const copySpan = codeBlock.querySelector('span:last-child');
                 copySpan.textContent = 'Copied!';
                 setTimeout(() => copySpan.textContent = 'Copy', 1500);
             });
         });

         // Intercept click on links
         const dlWinLink = document.getElementById('dl-win');
         const dlMacLink = document.getElementById('dl-mac');
         const dlLinuxLink = document.getElementById('dl-linux');
         const dlLinks = [dlWinLink, dlMacLink, dlLinuxLink].filter(Boolean);

         dlLinks.forEach(link => {
             link.addEventListener('click', (e) => {
                 if (!link.classList.contains('primed-for-download')) {
                     e.preventDefault();
                     
                     // Show tip with CSS transition
                     npxTip.style.display = 'block';
                     npxTip.offsetHeight; // force layout reflow
                     npxTip.style.opacity = '1';
                     npxTip.style.transform = 'translateY(0)';

                     // Prime all download links and update primary button text
                     dlLinks.forEach(l => {
                         l.classList.add('primed-for-download');
                     });
                     
                     if (dlWinLink) {
                         const versionTagText = dlWinLink.querySelector('.version-tag') ? dlWinLink.querySelector('.version-tag').outerHTML : '';
                         dlWinLink.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Confirm Download ${versionTagText}`;
                     }
                 }
             });
         });
     }

    // === Theme Toggle Logic ===
    const themeToggle = document.getElementById('theme-toggle');
    const body = document.body;

    const updateToggleUI = () => {
        if (themeToggle) {
            const span = themeToggle.querySelector('span');
            if (span) {
                span.textContent = body.classList.contains('dark-theme') ? 'DARK' : 'LIGHT';
            }
        }
    };

    // Check localStorage for saved theme
    const savedTheme = localStorage.getItem('gatekeeper-theme');
    if (savedTheme) {
        if (savedTheme === 'light-theme') {
            body.classList.remove('dark-theme');
            body.classList.add('light-theme');
        } else {
            body.classList.remove('light-theme');
            body.classList.add('dark-theme');
        }
    } else {
        // Default to dark theme for all pages
        body.classList.add('dark-theme');
        body.classList.remove('light-theme');
    }
    updateToggleUI();

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            if (body.classList.contains('dark-theme')) {
                body.classList.remove('dark-theme');
                body.classList.add('light-theme');
                localStorage.setItem('gatekeeper-theme', 'light-theme');
            } else {
                body.classList.remove('light-theme');
                body.classList.add('dark-theme');
                localStorage.setItem('gatekeeper-theme', 'dark-theme');
            }
            updateToggleUI();
        });
    }

    // === Newsletter form submit mock ===
    const newsletterButtons = document.querySelectorAll('.newsletter-input button');
    newsletterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const input = btn.previousElementSibling;
            if (input && input.value && input.value.trim() !== "") {
                const emailValue = input.value.trim();
                const originalContent = btn.innerHTML;
                
                // Show loading state or immediately show success animation
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                btn.style.backgroundColor = "var(--brand-green)";
                btn.style.color = "#000";
                input.value = "Subscribed!";
                input.disabled = true;

                // Send AJAX request to FormSubmit.co
                fetch('https://formsubmit.co/ajax/rautv2005@gmail.com', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        email: emailValue,
                        _subject: "New Gatekeeper Newsletter Subscriber"
                    })
                })
                .then(res => res.json())
                .then(data => {
                    console.log('Subscription success:', data);
                })
                .catch(err => {
                    console.error('Subscription error:', err);
                });

                setTimeout(() => {
                    btn.innerHTML = originalContent;
                    btn.style.backgroundColor = "";
                    btn.style.color = "";
                    input.value = "";
                    input.disabled = false;
                }, 3000);
            }
        });
    });

});
