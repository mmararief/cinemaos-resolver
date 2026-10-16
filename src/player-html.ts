export function renderPlayerHtml(serverOrigin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CinemaOS VIP Stream Player</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎬</text></svg>">
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.7/dist/hls.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/artplayer@5.1.6/dist/artplayer.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #090a0f;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #11131a;
      border-bottom: 1px solid #1f2430;
      padding: 0.85rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      font-weight: 700;
      font-size: 1.15rem;
      color: #38bdf8;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .badge {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      font-size: 0.75rem;
    }
    .main-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
      padding: 1.5rem;
      gap: 1.25rem;
    }
    .player-wrapper {
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #000;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      position: relative;
    }
    #artplayer {
      width: 100%;
      height: 100%;
    }
    .info-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      background: #11131a;
      border: 1px solid #1f2430;
      border-radius: 10px;
      padding: 1rem 1.25rem;
    }
    .title-box h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #fff;
    }
    .title-box p {
      font-size: 0.85rem;
      color: #94a3b8;
      margin-top: 0.25rem;
    }
    .controls-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: flex-end;
    }
    .control {
      display: flex;
      flex-direction: column;
    }
    .control label {
      font-size: 0.72rem;
      color: #94a3b8;
      margin-bottom: 0.2rem;
      letter-spacing: 0.01em;
    }
    select {
      background: #1e2230;
      color: #fff;
      border: 1px solid #334155;
      padding: 0.5rem 0.85rem;
      border-radius: 6px;
      font-size: 0.85rem;
      outline: none;
      cursor: pointer;
      max-width: 260px;
    }
    select:focus {
      border-color: #38bdf8;
    }
    select.control-active {
      border-color: rgba(56, 189, 248, 0.6);
      background: #172033;
    }
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(9, 10, 15, 0.85);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      z-index: 10;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid #1e293b;
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span>🎬</span> CinemaOS VIP Player
    </div>
    <span class="badge">Direct Proxy Stream</span>
  </header>

  <div class="main-container">
    <div class="player-wrapper">
      <div id="artplayer"></div>
      <div class="loading-overlay" id="loadingOverlay">
        <div class="spinner"></div>
        <div id="loadingText" style="font-weight: 500;">Resolving media streams & subtitles...</div>
      </div>
    </div>

    <div class="info-bar">
      <div class="title-box">
        <h1 id="mediaTitle">Loading...</h1>
        <p id="mediaMeta">CinemaOS Multi-Server Adaptive Stream</p>
      </div>

      <div class="controls-row">
        <div class="control" id="dubWrap" style="display: none;">
          <label>Dub / Audio Language</label>
          <select id="dubSelect" onchange="changeDub()"></select>
        </div>
        <div class="control">
          <label>Server / Quality</label>
          <select id="serverSelect" onchange="changeServer()"></select>
        </div>
        <div class="control" id="audioTrackWrap" style="display: none;">
          <label>In-Stream Audio Track</label>
          <select id="audioTrackSelect" onchange="changeAudioTrack()"></select>
        </div>
        <div class="control">
          <label>Subtitle Track</label>
          <select id="subtitleSelect" onchange="changeSubtitle()"></select>
        </div>
      </div>
    </div>
  </div>

  <script>
    let art = null;
    let currentData = null;
    let filteredSources = [];

    const params = new URLSearchParams(window.location.search);
    const mediaId = params.get('id') || params.get('tmdbId') || '';
    const mediaTitle = params.get('title') || '';
    const mediaType = params.get('type') || 'movie';
    const season = params.get('s') || params.get('season') || '1';
    const episode = params.get('e') || params.get('episode') || '1';
    const directUrl = params.get('url') || '';
    const directSub = params.get('sub') || '';

    function buildProxiedUrl(rawUrl) {
      if (!rawUrl) return '';
      return '${serverOrigin}/api/proxy?url=' + encodeURIComponent(rawUrl);
    }

    async function init() {
      const overlay = document.getElementById('loadingOverlay');
      const titleElem = document.getElementById('mediaTitle');
      const metaElem = document.getElementById('mediaMeta');

      // 1. Direct URL mode
      if (directUrl) {
        titleElem.textContent = mediaTitle || 'Direct Stream';
        metaElem.textContent = 'Custom stream with CinemaOS proxy';
        overlay.style.display = 'none';

        const subs = [];
        if (directSub) {
          subs.push({
            url: buildProxiedUrl(directSub),
            name: 'Subtitle Track',
            isIndonesian: true
          });
        }
        setupPlayer(buildProxiedUrl(directUrl), subs);
        return;
      }

      // 2. Resolve via CinemaOS API
      const resolveParams = new URLSearchParams();
      if (mediaId) resolveParams.set('id', mediaId);
      if (mediaTitle) resolveParams.set('title', mediaTitle);
      resolveParams.set('type', mediaType);
      if (mediaType === 'tv') {
        resolveParams.set('s', season);
        resolveParams.set('e', episode);
      }

      try {
        const res = await fetch('${serverOrigin}/api/resolve?' + resolveParams.toString());
        const data = await res.json();

        if (!data.success || !data.sources || data.sources.length === 0) {
          document.getElementById('loadingText').textContent = 'Error: ' + (data.error || 'No streams found');
          return;
        }

        currentData = data;
        overlay.style.display = 'none';

        titleElem.textContent = data.title || (mediaType === 'tv' ? \`Series S\${season}E\${episode}\` : 'Movie');
        metaElem.textContent = \`TMDB ID: \${data.tmdbId} • \${data.sources.length} Servers Available • \${data.subtitles?.length || 0} Subtitles\`;

        populateSubtitles(data.subtitles || []);
        populateDubs(data.sources);
      } catch (err) {
        document.getElementById('loadingText').textContent = 'Failed to load: ' + err.message;
      }
    }

    let currentHls = null;
    let currentDash = null;

    function setupPlayer(streamUrl, subtitlesList, isMp4File) {
      if (currentHls) {
        try { currentHls.destroy(); } catch {}
        currentHls = null;
      }
      if (currentDash) {
        try { currentDash.reset(); } catch {}
        currentDash = null;
      }
      if (art && art.destroy) {
        try {
          art.destroy(false);
        } catch {}
      }
      const container = document.getElementById('artplayer');
      if (container) container.innerHTML = '';

      // Audio track selector only applies to the stream we are about to load
      hideAudioTracks();

      const isDash = !isMp4File && (streamUrl.includes('.mpd') || streamUrl.includes('dash+xml'));
      const isHls = !isMp4File && (streamUrl.includes('.m3u8') || streamUrl.includes('mpegurl'));
      const playerType = isDash ? 'mpd' : isHls ? 'm3u8' : 'mp4';

      // Pick active subtitle
      let defaultSub = null;
      if (subtitlesList && subtitlesList.length > 0) {
        defaultSub = subtitlesList.find(s => s.isIndonesian) || subtitlesList[0];
      }

      art = new Artplayer({
        container: '#artplayer',
        url: streamUrl,
        type: playerType,
        autoplay: true,
        autoOrientation: true,
        pip: true,
        fullscreen: true,
        fullscreenWeb: true,
        playbackRate: true,
        setting: true,
        theme: '#38bdf8',
        subtitle: defaultSub ? {
          url: defaultSub.url,
          type: defaultSub.url.includes('.vtt') ? 'vtt' : 'srt',
          style: {
            color: '#ffffff',
            fontSize: '26px',
            textShadow: '0 2px 4px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 0.95)'
          },
          encoding: 'utf-8',
        } : undefined,
        customType: {
          m3u8: function (video, url) {
            if (Hls.isSupported()) {
              currentHls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
              });
              currentHls.loadSource(url);
              currentHls.attachMedia(video);
              currentHls.on(Hls.Events.MANIFEST_PARSED, function () {
                populateAudioTracks(currentHls.audioTracks || []);
              });
              currentHls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () {
                populateAudioTracks(currentHls.audioTracks || []);
              });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
              video.src = url;
              hideAudioTracks();
            }
          },
          mpd: function (video, url) {
            currentDash = dashjs.MediaPlayer().create();
            currentDash.initialize(video, url, true);
            currentDash.on('streamInitialized', function () {
              populateAudioTracks(currentDash.getTracksFor('audio'));
            });
          }
        }
      });

      art.on('error', (err) => {
        console.warn('Playback error on server:', err);
      });
    }

    function playSourceIndex(index) {
      if (!filteredSources || !filteredSources[index]) return;
      const src = filteredSources[index];
      const proxiedUrl = buildProxiedUrl(src.url);

      const subList = (currentData.subtitles || []).map(s => ({
        url: buildProxiedUrl(s.file),
        name: s.label,
        isIndonesian: s.isIndonesian
      }));

      setupPlayer(proxiedUrl, subList, src.type === 'mp4');
    }

    function changeServer() {
      const idx = document.getElementById('serverSelect').value;
      playSourceIndex(parseInt(idx, 10));
    }

    // ---- Dub / audio language management ----

    // Gathers every distinct audio language exposed by the scrapers and,
    // when more than one dub exists, reveals the dub switcher.
    function populateDubs(sources) {
      const dubWrap = document.getElementById('dubWrap');
      const dubSelect = document.getElementById('dubSelect');

      const langs = [];
      (sources || []).forEach(function (s) {
        if (s.audio && langs.indexOf(s.audio) === -1) langs.push(s.audio);
      });

      dubSelect.innerHTML = '';
      const allOpt = document.createElement('option');
      allOpt.value = '__all__';
      allOpt.textContent = '🔊 All audio dubs';
      dubSelect.appendChild(allOpt);

      langs.sort().forEach(function (lang) {
        const opt = document.createElement('option');
        opt.value = lang;
        opt.textContent = '🔊 ' + lang;
        dubSelect.appendChild(opt);
      });

      dubWrap.style.display = langs.length > 1 ? '' : 'none';
      dubSelect.value = '__all__';
      applyDubFilter('__all__');
    }

    // Filters the server list down to the chosen dub language and reloads it.
    function applyDubFilter(lang) {
      const all = (currentData && currentData.sources) ? currentData.sources : [];
      filteredSources = (!lang || lang === '__all__')
        ? all.slice()
        : all.filter(function (s) { return s.audio === lang; });

      // Never leave the user with an empty list
      if (filteredSources.length === 0) filteredSources = all.slice();

      const serverSelect = document.getElementById('serverSelect');
      serverSelect.innerHTML = '';
      filteredSources.forEach(function (src, idx) {
        const opt = document.createElement('option');
        opt.value = idx;
        const audioLabel = src.audio ? \` [🔊 \${src.audio}]\` : '';
        opt.textContent = \`[\${src.type.toUpperCase()}] \${src.label}\${audioLabel}\`;
        serverSelect.appendChild(opt);
      });

      const dubSelect = document.getElementById('dubSelect');
      dubSelect.classList.toggle('control-active', !!lang && lang !== '__all__');

      if (filteredSources.length > 0) playSourceIndex(0);
    }

    function changeDub() {
      applyDubFilter(document.getElementById('dubSelect').value);
    }

    // ---- Subtitle management ----

    function populateSubtitles(subtitles) {
      const subSelect = document.getElementById('subtitleSelect');
      subSelect.innerHTML = '<option value="-1">None (Off)</option>';

      let defaultSubIdx = -1;
      subtitles.forEach(function (sub, idx) {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = sub.isIndonesian ? \`🇮🇩 \${sub.label} (Indonesian)\` : sub.label;
        subSelect.appendChild(opt);

        if (sub.isIndonesian && defaultSubIdx === -1) {
          defaultSubIdx = idx;
        }
      });

      // Auto select Indonesian if available
      if (defaultSubIdx !== -1) {
        subSelect.value = defaultSubIdx;
      }
    }

    function changeSubtitle() {
      const subIdx = parseInt(document.getElementById('subtitleSelect').value, 10);
      if (!art) return;

      if (subIdx === -1) {
        art.subtitle.show = false;
      } else if (currentData && currentData.subtitles[subIdx]) {
        const sub = currentData.subtitles[subIdx];
        art.subtitle.switch(buildProxiedUrl(sub.file), {
          name: sub.label,
          type: sub.file.includes('.vtt') ? 'vtt' : 'srt',
        });
        art.subtitle.show = true;
      }
    }

    // ---- In-stream audio track management (HLS / DASH renditions) ----

    function hideAudioTracks() {
      const wrap = document.getElementById('audioTrackWrap');
      if (wrap) wrap.style.display = 'none';
    }

    function populateAudioTracks(tracks) {
      const wrap = document.getElementById('audioTrackWrap');
      const sel = document.getElementById('audioTrackSelect');

      if (!tracks || tracks.length <= 1) {
        hideAudioTracks();
        return;
      }

      sel.innerHTML = '';
      tracks.forEach(function (t, i) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = '🎧 ' + (t.name || t.lang || ('Audio ' + (i + 1)));
        sel.appendChild(opt);
      });

      wrap.style.display = '';
      const active = currentHls && typeof currentHls.audioTrack === 'number' ? currentHls.audioTrack : 0;
      sel.value = String(active);
    }

    function changeAudioTrack() {
      const i = parseInt(document.getElementById('audioTrackSelect').value, 10);
      if (currentHls && currentHls.audioTracks && currentHls.audioTracks[i]) {
        currentHls.audioTrack = i;
      } else if (currentDash) {
        const tracks = currentDash.getTracksFor('audio');
        if (tracks && tracks[i]) currentDash.setCurrentTrack(tracks[i]);
      }
    }

    window.addEventListener('DOMContentLoaded', init);
  </script>
</body>
</html>`;
}