<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sanbai · Executive Control Tower</title>
  <script src="https://identity.netlify.com/v1/netlify-identity-widget.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
  <style>
    :root {
      --orange: #F76B1C; --bg: #0B1020; --card: #161B2D; --text: #FFFFFF; --muted: #94A3B8;
    }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 30px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .card { background: var(--card); padding: 25px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.05); }
    .stat-val { font-size: 2.5rem; font-weight: 800; color: var(--orange); }
    .project-row { 
      display: flex; justify-content: space-between; padding: 15px 0; border-bottom: 1px solid rgba(255,255,255,0.1); 
      cursor: pointer; transition: 0.2s;
    }
    .project-row:hover { color: var(--orange); padding-left: 10px; }
    .loading-overlay { position: fixed; inset: 0; background: var(--bg); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 100; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div id="loader" class="loading-overlay">
    <i class="fas fa-circle-notch fa-spin fa-3x" style="color: var(--orange)"></i>
    <p style="margin-top:20px">Sincronizando Torre de Control...</p>
  </div>

  <div id="app" class="container hidden">
    <div class="header">
      <div>
        <h1 style="margin:0">Sanbai <span style="font-weight:200">UDN Enterprise</span></h1>
        <p style="color:var(--muted)">Resumen ejecutivo de operaciones</p>
      </div>
      <img src="https://sanbai.com.ar/wp-content/uploads/2023/10/logo-sanbai-white.png" alt="Sanbai" height="40">
    </div>

    <div class="grid" style="margin-bottom: 30px;">
      <div class="card">
        <p style="color:var(--muted); margin:0">Proyectos Activos</p>
        <div id="totalProj" class="stat-val">0</div>
      </div>
      <div class="card">
        <p style="color:var(--muted); margin:0">Margen Promedio</p>
        <div id="avgMargin" class="stat-val">0%</div>
      </div>
    </div>

    <div class="card">
      <h3>Proyectos en Curso</h3>
      <div id="projectList"></div>
    </div>
  </div>

  <script>
    async function fetchData() {
      const user = netlifyIdentity.currentUser();
      if (!user) { netlifyIdentity.identity.open(); return; }
      
      const token = await user.jwt();
      try {
        const res = await fetch('/.netlify/functions/presentation-data?type=enterprise', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        render(data);
      } catch (e) {
        console.error(e);
      }
    }

    function render(data) {
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      
      document.getElementById('totalProj').innerText = data.stats.total;
      document.getElementById('avgMargin').innerText = data.stats.margin + '%';
      
      document.getElementById('projectList').innerHTML = data.projects.map(p => `
        <div class="project-row" onclick="window.location.href='/project-viewer.html?key=${p.key}'">
          <div>
            <div style="font-weight:bold">${p.name}</div>
            <div style="font-size:0.8rem; color:var(--muted)">${p.subtitle}</div>
          </div>
          <div style="text-align:right">
            <i class="fas fa-chevron-right"></i>
          </div>
        </div>
      `).join('');
    }

    netlifyIdentity.on('init', u => { if(!u) netlifyIdentity.open(); else fetchData(); });
  </script>
</body>
</html>
