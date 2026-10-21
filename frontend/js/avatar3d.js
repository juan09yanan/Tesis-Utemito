/**
 * Utemito 3D Sculpted Avatar Engine (Three.js WebGL + GLSL 3D Relief & Morph Shader)
 *
 * Renderiza en 3D (estilo Blender Eevee/Cycles) el modelo exacto del buho Utemito
 * de la animacion original sobre una malla 3D esculpida de alta densidad (160x160
 * segmentos = 51,200 triangulos) con mapa de profundidad anatomico 3D (Z-displacement),
 * mapa de normales en espacio tangente (Normal Map), iluminacion PBR con reflejos
 * especulares dinamicos en ojos/botones/pico y deformacion esqueletica por vertices
 * a 60 FPS dentro del escenario 3D de la biblioteca.
 *
 * 3 flujos de animacion:
 *   1. 'saludo' -> Saluda al usuario al ingresar al sistema (despliega y agita el ala
 *                  en 3D, inclina la cabeza cordialmente, sonrie y balancea la borla).
 *   2. 'hablar' -> Habla sincronizando los visemas reales del pico + apertura mandibular
 *                  3D, asentimiento de cabeza y gestos conversacionales de las alas.
 *   3. 'reposo' -> Espera en la biblioteca con respiracion 3D en el pecho, parpadeo
 *                  natural periodico, rotacion 3D suave de cabeza y seguimiento del cursor.
 */
(function () {
  'use strict';

  function buildLibraryBackground(scene) {
    const libraryGroup = new THREE.Group();
    libraryGroup.position.set(0, 0, -1.55);

    const woodDarkMat = new THREE.MeshStandardMaterial({
      color: 0x24130a,
      roughness: 0.86,
      metalness: 0.04,
    });
    const woodShelfMat = new THREE.MeshStandardMaterial({
      color: 0x4c2b16,
      roughness: 0.72,
      metalness: 0.06,
    });
    const woodTrimMat = new THREE.MeshStandardMaterial({
      color: 0x6b3e21,
      roughness: 0.6,
      metalness: 0.08,
    });

    // Pared de madera del fondo
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(8.5, 8.5, 0.2), woodDarkMat);
    backWall.position.set(0, 0.4, -0.55);
    backWall.receiveShadow = true;
    libraryGroup.add(backWall);

    // Columnas laterales del estante
    [-2.72, 2.72].forEach((x) => {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 7.5, 0.95), woodShelfMat);
      pillar.position.set(x, 0.4, 0);
      pillar.receiveShadow = true;
      libraryGroup.add(pillar);
    });

    // Repisas horizontales y filas de libros 3D
    const shelfYs = [-1.85, -0.58, 0.72, 2.02];
    const bookColors = [
      0x147a38, 0x9c2b23, 0x1e4f82, 0xc28315, 0x5c2d73,
      0x186b5e, 0x7a421d, 0x22663b, 0xa83820, 0x29568f,
    ];
    const goldBandMat = new THREE.MeshStandardMaterial({
      color: 0xf5cf56,
      roughness: 0.35,
      metalness: 0.65,
    });
    const pageMat = new THREE.MeshStandardMaterial({
      color: 0xf5ead2,
      roughness: 0.8,
    });

    shelfYs.forEach((sy, sIdx) => {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.16, 0.88), woodShelfMat);
      shelf.position.set(0, sy, 0);
      shelf.receiveShadow = true;
      libraryGroup.add(shelf);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(5.64, 0.06, 0.92), woodTrimMat);
      trim.position.set(0, sy + 0.05, 0.02);
      libraryGroup.add(trim);

      let cursorX = -2.42;
      let bookIndex = sIdx * 7;
      while (cursorX < 2.32) {
        const bw = 0.22 + ((bookIndex * 19) % 10) * 0.012;
        const bh = 0.72 + ((bookIndex * 31) % 12) * 0.022;
        const bd = 0.56 + ((bookIndex * 13) % 6) * 0.018;

        if (cursorX + bw > 2.42) break;

        const bColor = bookColors[bookIndex % bookColors.length];
        const bookMat = new THREE.MeshStandardMaterial({
          color: bColor,
          roughness: 0.56,
          metalness: 0.08,
        });

        const bookGroup = new THREE.Group();
        const cx = cursorX + bw / 2;
        const cy = sy + 0.08 + bh / 2;
        bookGroup.position.set(cx, cy, -0.02);

        const spine = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.95, bh, bd), bookMat);
        bookGroup.add(spine);

        const pages = new THREE.Mesh(
          new THREE.BoxGeometry(bw * 0.78, 0.03, bd * 0.92),
          pageMat
        );
        pages.position.set(0, bh / 2 + 0.005, 0);
        bookGroup.add(pages);

        const band1 = new THREE.Mesh(
          new THREE.BoxGeometry(bw * 0.97, 0.035, 0.03),
          goldBandMat
        );
        band1.position.set(0, bh * 0.26, bd / 2);
        bookGroup.add(band1);

        const band2 = band1.clone();
        band2.position.set(0, -bh * 0.24, bd / 2);
        bookGroup.add(band2);

        libraryGroup.add(bookGroup);
        cursorX += bw + 0.015;
        bookIndex++;
      }
    });

    // Mostrador de madera frontal donde se posa Utemito
    const deskBase = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.55, 2.6), woodShelfMat);
    deskBase.position.set(0, -1.85, 1.15);
    libraryGroup.add(deskBase);

    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.1, 2.7), woodTrimMat);
    deskTop.position.set(0, -1.55, 1.18);
    libraryGroup.add(deskTop);

    scene.add(libraryGroup);
    return libraryGroup;
  }

  const OWL_VERTEX_SHADER = `
    uniform sampler2D uDepthMap;
    uniform sampler2D uWaveDepthMap;
    uniform float uTime;
    uniform float uBreath;
    uniform vec3 uHeadRot;      // x = pitch, y = yaw, z = roll
    uniform float uTalkOpen;    // 0..1 apertura mandibular
    uniform float uWaveMix;     // 0..1 mezcla de pose de saludo
    uniform float uWaveAngle;   // oscilacion del ala al saludar
    uniform float uWingGesture; // gesto de las alas al hablar
    uniform float uTasselSwing; // oscilacion fisica de la borla

    varying vec2 vUv;
    varying vec3 vViewPos;
    varying float vHeadWeight;
    varying float vDepthVal;

    mat3 rotateXYZ(vec3 r) {
      float cx = cos(r.x), sx = sin(r.x);
      float cy = cos(r.y), sy = sin(r.y);
      float cz = cos(r.z), sz = sin(r.z);
      mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, -sx, 0.0, sx, cx);
      mat3 ry = mat3(cy, 0.0, sy, 0.0, 1.0, 0.0, -sy, 0.0, cy);
      mat3 rz = mat3(cz, -sz, 0.0, sz, cz, 0.0, 0.0, 0.0, 1.0);
      return rz * ry * rx;
    }

    void main() {
      vUv = uv;

      float dBase = texture2D(uDepthMap, uv).r;
      float dWave = texture2D(uWaveDepthMap, uv).r;
      float depth = mix(dBase, dWave, uWaveMix);
      vDepthVal = depth;

      vec3 pos = position;

      // 1. Relieve escultorico 3D (Z-displacement estilo Blender Sculpt)
      pos.z += depth * 0.72;

      // 2. Respiracion 3D organica en el pecho y chaleco (uv.y entre 0.12 y 0.56)
      float chestMask = smoothstep(0.08, 0.32, uv.y) * (1.0 - smoothstep(0.48, 0.62, uv.y));
      float centerChest = exp(-pow((uv.x - 0.5) / 0.25, 2.0));
      pos.z += uBreath * 0.055 * chestMask * centerChest;
      pos.y += uBreath * 0.022 * chestMask;

      // 3. Articulacion mandibular 3D en el pico y barbilla al hablar
      float jawMask = exp(-pow((uv.x - 0.496) / 0.068, 2.0) - pow((uv.y - 0.625) / 0.055, 2.0));
      pos.y -= uTalkOpen * 0.042 * jawMask;
      pos.z += uTalkOpen * 0.035 * jawMask;

      // 4. Oscilacion fisica de la borla del birrete (lado superior izquierdo)
      float tasselMask = (1.0 - smoothstep(0.24, 0.35, uv.x)) *
                         smoothstep(0.66, 0.76, uv.y) *
                         (1.0 - smoothstep(0.92, 0.98, uv.y));
      float tasselDist = max(0.0, 0.90 - uv.y);
      pos.x += uTasselSwing * tasselDist * 0.45 * tasselMask;
      pos.z += abs(uTasselSwing) * tasselDist * 0.22 * tasselMask;

      // 5. Movimiento 3D en profundidad del ala levantada durante el saludo
      float waveWingMask = (1.0 - smoothstep(0.32, 0.45, uv.x)) *
                           smoothstep(0.24, 0.38, uv.y) *
                           (1.0 - smoothstep(0.84, 0.92, uv.y)) * uWaveMix;
      if (waveWingMask > 0.001) {
        pos.z += (0.06 + sin(uWaveAngle * 2.0) * 0.045) * waveWingMask;
      }

      // 6. Gesto conversacional 3D de las alas laterales al hablar
      float sideWingMask = (smoothstep(0.16, 0.36, abs(uv.x - 0.5))) *
                           smoothstep(0.18, 0.35, uv.y) *
                           (1.0 - smoothstep(0.54, 0.64, uv.y)) * (1.0 - uWaveMix);
      pos.z += uWingGesture * 0.09 * sideWingMask;
      pos.x += sign(uv.x - 0.5) * uWingGesture * 0.035 * sideWingMask;

      // 7. Giro volumetrico de la cabeza hacia el puntero del mouse (paralaje por profundidad)
      // En lugar de girar la malla como un plano rigido (lo que la hacia ver como un
      // papel doblado), cada punto se desplaza segun su profundidad anatomica: el pico
      // y los ojos (mas cercanos) se mueven mas que los bordes de la cabeza, simulando
      // una rotacion 3D real de un volumen redondeado sin pliegues.
      float headWeight = smoothstep(0.40, 0.60, uv.y) * (1.0 - waveWingMask * 0.85);
      vHeadWeight = headWeight;

      // Curvatura esferica de la cabeza: el centro del rostro sobresale mas que los lados
      vec2 headCenter = vec2(0.5, 0.70);
      vec2 hd = (uv - headCenter) / vec2(0.26, 0.22);
      float headDome = clamp(1.0 - dot(hd, hd), 0.0, 1.0);
      float volume = depth * 0.75 + headDome * 0.55;

      float yaw = -uHeadRot.y;   // + mira a la derecha
      float pitch = uHeadRot.x;  // - mira hacia abajo
      // Desplazamiento por volumen (giro) + leve compresion del lado que se aleja
      pos.x += yaw * (0.06 + volume * 0.34) * headWeight;
      pos.y += pitch * (0.05 + volume * 0.28) * headWeight;
      pos.x -= yaw * (uv.x - 0.5) * abs(yaw) * 0.6 * headWeight;

      // Paralaje sutil del cuerpo (respuesta del torso al giro de la cabeza)
      float bodyW = 1.0 - headWeight;
      pos.x += yaw * depth * 0.10 * bodyW;
      pos.y += pitch * depth * 0.06 * bodyW;

      // Inclinacion lateral (roll) solo en el plano, alrededor del cuello: sin pliegues
      vec3 neckPivot = vec3(0.0, 0.10, 0.0);
      vec3 relH = pos - neckPivot;
      float roll = uHeadRot.z * headWeight;
      float cr = cos(roll), sr = sin(roll);
      relH.xy = vec2(relH.x * cr - relH.y * sr, relH.x * sr + relH.y * cr);
      pos = neckPivot + relH;

      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      vViewPos = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const OWL_FRAGMENT_SHADER = `
    uniform sampler2D uTexBase;
    uniform sampler2D uTexBlink;
    uniform sampler2D uTexTalkMid;
    uniform sampler2D uTexTalkOpen;
    uniform sampler2D uTexBodyNoWing;
    uniform sampler2D uTexWingOnly;
    uniform sampler2D uNormalMap;
    uniform sampler2D uWaveNormalMap;

    uniform float uBlink;
    uniform float uTalkMidMix;
    uniform float uTalkOpenMix;
    uniform float uWaveMix;
    uniform float uWaveAngle;
    uniform vec3 uHeadRot;
    uniform vec2 uPointer;

    varying vec2 vUv;
    varying vec3 vViewPos;
    varying float vHeadWeight;
    varying float vDepthVal;

    void main() {
      // 1. Mezcla fluida de estados faciales (Reposo / Parpadeo / Habla)
      vec4 colBase = texture2D(uTexBase, vUv);
      vec4 colBlink = texture2D(uTexBlink, vUv);
      vec4 colTalkMid = texture2D(uTexTalkMid, vUv);
      vec4 colTalkOpen = texture2D(uTexTalkOpen, vUv);

      vec4 faceState = mix(colBase, colTalkMid, uTalkMidMix);
      faceState = mix(faceState, colTalkOpen, uTalkOpenMix);

      // El parpadeo se aplica en la region ocular
      float eyeRegion = smoothstep(0.62, 0.68, vUv.y) * (1.0 - smoothstep(0.79, 0.84, vUv.y));
      faceState = mix(faceState, colBlink, uBlink * eyeRegion);

      // 2. Composicion articulada del saludo: ala solida rotando sobre el hombro
      // detras del cuerpo con el pico cerrado (sin simular hablar ni desaparecer).
      vec2 shoulderPivot = vec2(0.3036, 0.4810);
      vec2 relUv = vUv - shoulderPivot;
      float cW = cos(-uWaveAngle);
      float sW = sin(-uWaveAngle);
      vec2 rotUv = shoulderPivot + vec2(
        relUv.x * cW - relUv.y * sW,
        relUv.x * sW + relUv.y * cW
      );

      vec4 wingCol = vec4(0.0);
      if (rotUv.x >= 0.0 && rotUv.x <= 1.0 && rotUv.y >= 0.0 && rotUv.y <= 1.0) {
        wingCol = texture2D(uTexWingOnly, rotUv);
      }

      vec4 bodyCol = texture2D(uTexBodyNoWing, vUv);
      bodyCol = mix(bodyCol, colBlink, uBlink * eyeRegion);

      vec3 waveRgb = mix(wingCol.rgb, bodyCol.rgb, bodyCol.a);
      float waveAlpha = max(wingCol.a, bodyCol.a);
      vec4 waveCol = vec4(waveRgb, waveAlpha);

      vec4 albedo = mix(faceState, waveCol, uWaveMix);
      if (albedo.a < 0.03) discard;

      // 3. Mapa de normales 3D + iluminacion PBR de estudio (estilo Blender)
      vec3 nBase = texture2D(uNormalMap, vUv).rgb * 2.0 - 1.0;
      vec3 nWave = texture2D(uWaveNormalMap, vUv).rgb * 2.0 - 1.0;
      vec3 N = normalize(mix(nBase, nWave, uWaveMix));

      // Orienta las normales segun el giro 3D de la cabeza y el puntero
      N.x -= uHeadRot.y * 0.75 * vHeadWeight;
      N.y += uHeadRot.x * 0.75 * vHeadWeight;
      N = normalize(N);

      vec3 V = normalize(vViewPos);
      vec3 Lkey = normalize(vec3(-0.32 + uPointer.x * 0.18, 0.42 - uPointer.y * 0.15, 0.85));
      vec3 Lfill = normalize(vec3(0.48, -0.15, 0.82));

      float diffKey = max(dot(N, Lkey), 0.0);
      float diffFill = max(dot(N, Lfill), 0.0);

      // Sombreado tridimensional suave que preserva los colores originales
      float shade = 0.88 + 0.18 * diffKey + 0.06 * diffFill;

      // Brillo especular 3D en ojos, pico, botones dorados y bordes dorados del chaleco
      vec3 H = normalize(Lkey + V);
      float specRaw = pow(max(dot(N, H), 0.0), 28.0);
      float isGold = step(0.55, albedo.r) * step(0.42, albedo.g) * (1.0 - step(0.38, albedo.b));
      float isGlossyEyeOrBeak = eyeRegion * 0.55;
      float specStrength = (0.06 + isGold * 0.28 + isGlossyEyeOrBeak * 0.18);
      vec3 specCol = vec3(1.0, 0.95, 0.82) * specRaw * specStrength;

      // Luz de contorno calida 3D (Rim Light de biblioteca)
      float rim = pow(1.0 - max(dot(N, vec3(0.0, 0.0, 1.0)), 0.0), 2.8);
      vec3 rimCol = vec3(1.0, 0.82, 0.45) * rim * 0.14;

      vec3 finalRgb = albedo.rgb * shade + specCol + rimCol;
      gl_FragColor = vec4(finalRgb, albedo.a);
    }
  `;

  function initUtemitoAvatar3D() {
    const container = document.getElementById('avatarWrap');
    if (!container || typeof THREE === 'undefined') return null;

    container.innerHTML = '';

    const width = container.clientWidth || 350;
    const height = container.clientHeight || 350;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x21130b);

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 50);
    camera.position.set(0, 0.02, 5.25);
    camera.lookAt(0, 0.0, 0);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch (e) {
      console.error('Error iniciando WebGL para el avatar 3D:', e);
      return null;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.className = 'buho-3d-canvas';
    container.appendChild(renderer.domElement);

    // Iluminacion 3D para el escenario de biblioteca
    const hemiLight = new THREE.HemisphereLight(0xfff4d8, 0x3b2212, 0.95);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff2d6, 1.2);
    keyLight.position.set(2.6, 3.8, 4.5);
    scene.add(keyLight);

    const warmLampLeft = new THREE.PointLight(0xffb84d, 0.9, 9);
    warmLampLeft.position.set(-2.1, 1.8, 0.6);
    scene.add(warmLampLeft);

    const warmLampRight = new THREE.PointLight(0xffb84d, 0.9, 9);
    warmLampRight.position.set(2.1, 1.8, 0.6);
    scene.add(warmLampRight);

    buildLibraryBackground(scene);

    // Carga de texturas y mapas 3D de alta definicion del buho Utemito
    const loader = new THREE.TextureLoader();
    const loadTex = (url) => {
      const t = loader.load(url);
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      return t;
    };

    const uniforms = {
      uTexBase: { value: loadTex('/assets/avatar3d/owl_base.webp?v=26') },
      uTexBlink: { value: loadTex('/assets/avatar3d/owl_blink.webp?v=26') },
      uTexTalkMid: { value: loadTex('/assets/avatar3d/owl_talk_mid.webp?v=26') },
      uTexTalkOpen: { value: loadTex('/assets/avatar3d/owl_talk_open.webp?v=26') },
      uTexBodyNoWing: { value: loadTex('/assets/avatar3d/owl_body_no_wing.webp?v=26') },
      uTexWingOnly: { value: loadTex('/assets/avatar3d/owl_wing_only.webp?v=26') },
      uDepthMap: { value: loadTex('/assets/avatar3d/owl_depth.webp?v=26') },
      uWaveDepthMap: { value: loadTex('/assets/avatar3d/owl_wave_depth.webp?v=26') },
      uNormalMap: { value: loadTex('/assets/avatar3d/owl_normal.webp?v=26') },
      uWaveNormalMap: { value: loadTex('/assets/avatar3d/owl_wave_normal.webp?v=26') },

      uTime: { value: 0 },
      uBreath: { value: 0 },
      uHeadRot: { value: new THREE.Vector3(0, 0, 0) },
      uTalkOpen: { value: 0 },
      uTalkMidMix: { value: 0 },
      uTalkOpenMix: { value: 0 },
      uBlink: { value: 0 },
      uWaveMix: { value: 0 },
      uWaveAngle: { value: -0.68 },
      uWingGesture: { value: 0 },
      uTasselSwing: { value: 0 },
      uPointer: { value: new THREE.Vector2(0, 0) },
    };

    // Malla 3D esculpida de alta densidad (160x160 = 51,200 triangulos)
    const owlGeo = new THREE.PlaneGeometry(3.15, 3.15, 160, 160);
    const owlMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: OWL_VERTEX_SHADER,
      fragmentShader: OWL_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
    });

    const owlMesh = new THREE.Mesh(owlGeo, owlMat);
    owlMesh.position.set(0, -0.02, 0.15);
    scene.add(owlMesh);

    // Particulas flotantes calidas en 3D
    const dustCount = 28;
    const dustGeo = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * 4.2;
      dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 3.6;
      dustPositions[i * 3 + 2] = -0.8 + Math.random() * 1.6;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xffe494,
      size: 0.052,
      transparent: true,
      opacity: 0.65,
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    scene.add(dustPoints);

    // Estados de animacion: 'saludo' | 'reposo' | 'hablar'
    let currentState = 'reposo';
    let subState = null; // 'pensando' | 'escuchando' | null
    let stateStartTime = performance.now() * 0.001;
    const greetingDuration = 3.2;
    let onGreetingEnd = null;

    // Puntero para que la cabeza siga al cursor del mouse de forma natural y fluida
    let targetPointerX = 0;
    let targetPointerY = 0;
    let smoothPointerX = 0;
    let smoothPointerY = 0;

    function updatePointerFromEvent(e) {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.42;
      const normX = (e.clientX - cx) / Math.max(window.innerWidth * 0.36, 220);
      const normY = (e.clientY - cy) / Math.max(window.innerHeight * 0.36, 220);
      targetPointerX = Math.max(-1, Math.min(1, normX));
      targetPointerY = Math.max(-1, Math.min(1, normY));
    }

    window.addEventListener('pointermove', updatePointerFromEvent, { passive: true });
    window.addEventListener('mousemove', updatePointerFromEvent, { passive: true });

    let nextBlinkTime = 1.8;
    let blinkEndTime = 0;

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function smoothstep(edge0, edge1, x) {
      const k = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return k * k * (3 - 2 * k);
    }

    function setState(nombre, { loop = true, alTerminar = null } = {}) {
      currentState = nombre;
      stateStartTime = performance.now() * 0.001;
      if (nombre === 'saludo') {
        uniforms.uWaveMix.value = 1.0;
        uniforms.uWaveAngle.value = -0.68;
      }
      if (nombre === 'saludo' && !loop && typeof alTerminar === 'function') {
        onGreetingEnd = alTerminar;
      } else {
        onGreetingEnd = null;
      }
    }

    function setSubState(st) {
      subState = st || null;
    }

    const clock = new THREE.Clock();

    function animate() {
      requestAnimationFrame(animate);

      const dt = Math.min(clock.getDelta(), 0.05);
      const t = performance.now() * 0.001;
      const elapsedInState = t - stateStartTime;

      smoothPointerX = lerp(smoothPointerX, targetPointerX, Math.min(1.0, dt * 8.5));
      smoothPointerY = lerp(smoothPointerY, targetPointerY, Math.min(1.0, dt * 8.5));

      uniforms.uTime.value = t;
      uniforms.uPointer.value.set(smoothPointerX, smoothPointerY);
      uniforms.uBreath.value = Math.sin(t * 2.3);

      // Valores objetivo de las animaciones 3D
      let targetWaveMix = 0.0;
      let targetWaveAngle = -0.68;

      let targetTalkMid = 0.0;
      let targetTalkOpen = 0.0;
      let targetJawOpen = 0.0;
      let targetWingGesture = 0.0;

      // Seguimiento 3D de la cabeza hacia el puntero del mouse
      // (En GLSL mat3 column-major con neckPivot.z = -0.65:
      //  uHeadRot.y negativo gira hacia la derecha (+X),
      //  uHeadRot.x negativo inclina hacia abajo (-Y))
      const mouseYaw = -smoothPointerX * 0.34;
      const mousePitch = -smoothPointerY * 0.24;
      const mouseRoll = -smoothPointerX * 0.085;

      let targetHeadPitch = mousePitch + Math.cos(t * 1.2) * 0.018;
      let targetHeadYaw = mouseYaw + Math.sin(t * 0.85) * 0.025;
      let targetHeadRoll = mouseRoll + Math.sin(t * 0.75) * 0.015;
      let targetTassel = smoothPointerX * 0.14 + Math.sin(t * 2.1) * 0.04;

      // La malla casi no rota (rotarla revela que es plana); el giro lo hace el shader por volumen
      let targetMeshRotY = smoothPointerX * 0.025 + Math.sin(t * 0.8) * 0.008;
      let targetMeshRotX = smoothPointerY * 0.015;
      let targetMeshY = -0.02 + Math.sin(t * 2.3) * 0.015;

      // -------------------- 1. FLUJO DE SALUDO (AL INGRESAR) --------------------
      if (currentState === 'saludo') {
        const p = Math.min(1.0, elapsedInState / greetingDuration);

        // El cuerpo sin ala lateral + el ala articulada se mantienen 100% solidos (sin desaparecer)
        targetWaveMix = 1.0;

        // El ala sube desde el costado (-0.68 rad), saluda con fluidez y vuelve a bajar (-0.68 rad)
        const liftIn = smoothstep(0.0, 0.20, p);
        const liftOut = 1.0 - smoothstep(0.78, 1.0, p);
        const liftEnvelope = Math.min(liftIn, liftOut);
        const waveOsc = Math.sin(elapsedInState * 7.2) * 0.17 * liftEnvelope;
        targetWaveAngle = lerp(-0.68, 0.02, liftEnvelope) + waveOsc;

        // El pico permanece cerrado (NO simula hablar al saludar)
        targetTalkMid = 0.0;
        targetTalkOpen = 0.0;
        targetJawOpen = 0.0;

        // Durante el saludo el buho NO sigue al cursor: solo saluda con un gesto amable
        targetHeadRoll = -0.04 * liftEnvelope + Math.sin(elapsedInState * 3.6) * 0.03 * liftEnvelope;
        targetHeadYaw = Math.sin(elapsedInState * 2.8) * 0.05 * liftEnvelope;
        targetHeadPitch = 0.02 * liftEnvelope;
        targetTassel = Math.sin(elapsedInState * 7.2) * 0.14 * liftEnvelope;
        targetMeshRotY = 0.0;
        targetMeshRotX = 0.0;
        targetMeshY = -0.02 + Math.sin(elapsedInState * 3.6) * 0.022 * liftEnvelope;

        if (elapsedInState >= greetingDuration) {
          currentState = 'reposo';
          stateStartTime = t;
          uniforms.uWaveMix.value = 0.0;
          uniforms.uWaveAngle.value = -0.68;
          if (onGreetingEnd) {
            const cb = onGreetingEnd;
            onGreetingEnd = null;
            cb();
          }
        }
      }
      // -------------------- 2. FLUJO DE HABLAR --------------------
      else if (currentState === 'hablar') {
        // Cadencia natural de silabas para el pico y mandibula 3D
        const syl1 = Math.max(0.0, Math.sin(t * 14.5));
        const syl2 = Math.max(0.0, Math.sin(t * 8.8 + 1.3));
        const cadence = (syl1 * 0.65 + syl2 * 0.35) * (0.35 + 0.65 * Math.max(0.0, Math.sin(t * 2.4)));

        if (cadence < 0.45) {
          targetTalkMid = cadence / 0.45;
          targetTalkOpen = 0.0;
        } else {
          targetTalkMid = 1.0 - (cadence - 0.45) / 0.55;
          targetTalkOpen = (cadence - 0.45) / 0.55;
        }
        targetJawOpen = cadence;

        // Movimientos 3D expresivos de cabeza (siguiendo tambien al puntero) y alas al explicar
        targetHeadPitch = mousePitch * 0.85 + Math.sin(t * 4.6) * 0.055;
        targetHeadYaw = mouseYaw * 0.85 + Math.sin(t * 2.2) * 0.08;
        targetHeadRoll = mouseRoll * 0.85 + Math.cos(t * 3.1) * 0.045;
        targetWingGesture = 0.5 + 0.5 * Math.sin(t * 4.2);
        targetTassel = smoothPointerX * 0.12 + Math.sin(t * 4.6) * 0.12;
        targetMeshRotY = smoothPointerX * 0.025 + Math.sin(t * 1.9) * 0.012;
        targetMeshY = -0.02 + Math.sin(t * 4.6) * 0.02;
      }
      // -------------------- 3. FLUJO DE ESPERA (REPOSO + SUB-ESTADOS) --------------------
      else {
        if (subState === 'pensando') {
          targetHeadYaw = mouseYaw * 0.6 + Math.sin(t * 2.4) * 0.18;
          targetHeadPitch = mousePitch * 0.6 + 0.08 + Math.cos(t * 3.0) * 0.04;
          targetHeadRoll = mouseRoll * 0.6 + Math.sin(t * 1.8) * 0.07;
          targetTassel = Math.sin(t * 3.2) * 0.11;
        } else if (subState === 'escuchando') {
          targetHeadPitch = mousePitch - 0.04 + Math.sin(t * 3.0) * 0.02;
          targetHeadRoll = mouseRoll - 0.06;
          targetMeshRotY = smoothPointerX * 0.03;
        }
      }

      // Parpadeo natural periodico
      if (t > nextBlinkTime) {
        blinkEndTime = t + 0.15;
        nextBlinkTime = t + 2.6 + Math.random() * 2.8;
      }
      const targetBlink = t < blinkEndTime ? 1.0 : 0.0;

      // Interpolacion suave de todos los parametros 3D
      const blend = Math.min(1.0, dt * 11.0);
      const fastBlend = Math.min(1.0, dt * 22.0);

      uniforms.uWaveMix.value = currentState === 'saludo' ? 1.0 : 0.0;
      uniforms.uWaveAngle.value = lerp(uniforms.uWaveAngle.value, targetWaveAngle, fastBlend);

      uniforms.uTalkMidMix.value = lerp(uniforms.uTalkMidMix.value, targetTalkMid, fastBlend);
      uniforms.uTalkOpenMix.value = lerp(uniforms.uTalkOpenMix.value, targetTalkOpen, fastBlend);
      uniforms.uTalkOpen.value = lerp(uniforms.uTalkOpen.value, targetJawOpen, fastBlend);
      uniforms.uWingGesture.value = lerp(uniforms.uWingGesture.value, targetWingGesture, blend);

      uniforms.uBlink.value = lerp(uniforms.uBlink.value, targetBlink, fastBlend);
      uniforms.uTasselSwing.value = lerp(uniforms.uTasselSwing.value, targetTassel, blend);

      uniforms.uHeadRot.value.x = lerp(uniforms.uHeadRot.value.x, targetHeadPitch, blend);
      uniforms.uHeadRot.value.y = lerp(uniforms.uHeadRot.value.y, targetHeadYaw, blend);
      uniforms.uHeadRot.value.z = lerp(uniforms.uHeadRot.value.z, targetHeadRoll, blend);

      owlMesh.rotation.y = lerp(owlMesh.rotation.y, targetMeshRotY, blend);
      owlMesh.rotation.x = lerp(owlMesh.rotation.x, targetMeshRotX, blend);
      owlMesh.position.y = lerp(owlMesh.position.y, targetMeshY, blend);

      // Particulas calidas de la biblioteca flotando suavemente
      const posAttr = dustGeo.getAttribute('position');
      for (let i = 0; i < dustCount; i++) {
        let py = posAttr.getY(i) + dt * 0.08;
        if (py > 1.8) py = -1.8;
        posAttr.setY(i, py);
      }
      posAttr.needsUpdate = true;

      renderer.render(scene, camera);
    }

    animate();

    const updateSize = () => {
      const w = container.clientWidth || 350;
      const h = container.clientHeight || 350;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateSize);
      ro.observe(container);
    } else {
      window.addEventListener('resize', updateSize);
    }

    return {
      setState,
      setSubState,
    };
  }

  window.UtemitoAvatar3D = initUtemitoAvatar3D();
})();
