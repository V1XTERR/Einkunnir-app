import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Exact studio-strip env texture from reference dna-helix.js
function makeEnvTexture(THREE, tone) {
  const c = document.createElement('canvas')
  c.width = 1024; c.height = 512
  const x = c.getContext('2d')

  if (tone === 'light') {
    const g = x.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0,    '#ffffff')
    g.addColorStop(0.26, '#e6e4e4')
    g.addColorStop(0.42, '#3b3939')
    g.addColorStop(0.56, '#050505')
    g.addColorStop(0.74, '#1c1b1b')
    g.addColorStop(0.88, '#9b9797')
    g.addColorStop(1,    '#ffffff')
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512)
    // hard studio strips — what gives chrome its edges
    x.fillStyle = '#ffffff'; x.fillRect(0, 120, 1024, 46); x.fillRect(0, 430, 1024, 20)
    x.fillStyle = '#000000'; x.fillRect(0, 300, 1024, 70); x.fillRect(140, 190, 320, 44)
  } else {
    const g = x.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0,    '#d8d8d8')
    g.addColorStop(0.30, '#4a4949')
    g.addColorStop(0.52, '#080808')
    g.addColorStop(0.72, '#2e2d2d')
    g.addColorStop(1,    '#bdbcbc')
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512)
    x.fillStyle = '#ffffff'; x.fillRect(0, 96, 1024, 26); x.fillRect(0, 386, 1024, 12)
    x.fillStyle = '#000000'; x.fillRect(300, 200, 420, 90)
  }

  const t = new THREE.CanvasTexture(c)
  t.mapping = THREE.EquirectangularReflectionMapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export default function DNAHelix({
  tone      = 'dark',
  accent    = '#ec3013',
  marks     = [],
  speed     = 26,
  radius    = 1.15,
  turns     = 3.4,
  thickness = 1,
  style,
}) {
  const mountRef  = useRef(null)
  const visibleRef = useRef(true)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const W = mount.clientWidth  || 400
    const H = mount.clientHeight || 400

    // Renderer — draw into a canvas we own
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'display:block;width:100%;height:100%'
    mount.appendChild(canvas)

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(W, H, false)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = tone === 'light' ? 0.98 : 1.05
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100)

    // Directional lights (same as reference)
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 6, 5)
    const rim = new THREE.DirectionalLight(0xffffff, 1.4); rim.position.set(-4, -2, -3)
    scene.add(key, rim)

    // Chrome env texture (studio strips)
    const envTex = makeEnvTexture(THREE, tone)
    scene.environment = envTex

    // Materials
    const chromeMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 1,
      roughness: 0.035,
      envMapIntensity: tone === 'dark' ? 2.2 : 1.45,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    })

    const accentMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(accent),
      metalness: 1,
      roughness: 0.14,
      envMapIntensity: 1.9,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    })

    const group = new THREE.Group()
    scene.add(group)

    // Geometry params (exact from reference)
    const R     = radius
    const H_val = 10           // helix total height
    const th    = thickness

    // Strands — Curve subclass approach
    class Strand extends THREE.Curve {
      constructor(phase) { super(); this.phase = phase }
      getPoint(t, target = new THREE.Vector3()) {
        const a = t * turns * Math.PI * 2 + this.phase
        return target.set(Math.cos(a) * R, (t - 0.5) * H_val, Math.sin(a) * R)
      }
    }

    for (const phase of [0, Math.PI]) {
      group.add(new THREE.Mesh(
        new THREE.TubeGeometry(new Strand(phase), 520, 0.125 * th, 20, false),
        chromeMat,
      ))
    }

    // Rungs + nodes
    const rungs   = Math.round(turns * 11)
    const rungGeo = new THREE.CylinderGeometry(0.075 * th, 0.075 * th, R * 2, 16)
    rungGeo.rotateZ(Math.PI / 2)
    const nodeGeo = new THREE.SphereGeometry(0.185 * th, 26, 20)

    for (let i = 0; i <= rungs; i++) {
      const t   = i / rungs
      const a   = t * turns * Math.PI * 2
      const y   = (t - 0.5) * H_val
      const m   = marks.length ? marks[i % marks.length] : null
      const mat = (m != null && m < 5) ? accentMat : chromeMat

      const bar = new THREE.Mesh(rungGeo, mat)
      bar.position.y = y
      bar.rotation.y = -a
      group.add(bar)

      for (const s of [1, -1]) {
        const n = new THREE.Mesh(nodeGeo, mat)
        n.position.set(Math.cos(a) * R * s, y, Math.sin(a) * R * s)
        group.add(n)
      }
    }

    group.rotation.x = -0.05
    group.rotation.z =  0.03

    // Position camera (same formula as reference)
    function positionCamera(w, h) {
      const aspect = w / h
      const target = (R * 2 + 0.5) / 0.88
      const z = target / (2 * Math.tan((30 * Math.PI / 180) / 2) * Math.max(0.28, aspect))
      camera.position.set(0, 0, Math.min(26, Math.max(5.5, z)))
      camera.aspect = aspect
      camera.updateProjectionMatrix()
    }
    positionCamera(W, H)

    // Animation
    let animId
    let last = performance.now()
    function loop(t) {
      animId = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      if (!visibleRef.current) return
      group.rotation.y += (Math.PI * 2 / speed) * dt
      group.position.y  = Math.sin(t / 4200) * 0.12
      renderer.render(scene, camera)
    }
    animId = requestAnimationFrame(loop)

    // Resize
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight
      renderer.setSize(w, h, false)
      positionCamera(w, h)
    })
    ro.observe(mount)

    // Visibility pause
    const io = new IntersectionObserver(([e]) => { visibleRef.current = e.isIntersecting }, { threshold: 0 })
    io.observe(mount)

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
      io.disconnect()
      renderer.dispose()
      if (mount.contains(canvas)) mount.removeChild(canvas)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tone, accent, JSON.stringify(marks), speed, radius, turns, thickness])

  return (
    <div
      ref={mountRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', ...style }}
    />
  )
}
