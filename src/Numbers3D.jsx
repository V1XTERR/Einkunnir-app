import { useEffect, useRef } from 'react'
import * as THREE from 'three'

function makeEnvTexture(tone) {
  const c = document.createElement('canvas')
  c.width = 1024; c.height = 512
  const x = c.getContext('2d')
  if (tone === 'light') {
    const g = x.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.26, '#e6e4e4')
    g.addColorStop(0.42, '#3b3939'); g.addColorStop(0.56, '#050505')
    g.addColorStop(0.74, '#1c1b1b'); g.addColorStop(0.88, '#9b9797')
    g.addColorStop(1, '#ffffff')
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512)
    x.fillStyle = '#ffffff'; x.fillRect(0, 120, 1024, 46); x.fillRect(0, 430, 1024, 20)
    x.fillStyle = '#000000'; x.fillRect(0, 300, 1024, 70); x.fillRect(140, 190, 320, 44)
  } else {
    const g = x.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, '#d8d8d8'); g.addColorStop(0.3, '#4a4949')
    g.addColorStop(0.52, '#080808'); g.addColorStop(0.72, '#2e2d2d')
    g.addColorStop(1, '#bdbcbc')
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512)
    x.fillStyle = '#ffffff'; x.fillRect(0, 96, 1024, 26); x.fillRect(0, 386, 1024, 12)
    x.fillStyle = '#000000'; x.fillRect(300, 200, 420, 90)
  }
  const t = new THREE.CanvasTexture(c)
  t.mapping = THREE.EquirectangularReflectionMapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export default function Numbers3D({ tone = 'dark', accent = '#ec3013', style }) {
  const mountRef = useRef(null)
  const visibleRef = useRef(true)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const W = mount.clientWidth || 400
    const H = mount.clientHeight || 400

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'display:block;width:100%;height:100%'
    mount.appendChild(canvas)

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(W, H, false)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = tone === 'light' ? 0.98 : 1.05
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene = new THREE.Scene()
    scene.environment = makeEnvTexture(tone)

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100)
    camera.position.z = 5.5

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(4, 6, 5)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.8)
    rimLight.position.set(-5, -4, 3)
    scene.add(keyLight, rimLight, new THREE.AmbientLight(0xffffff, 0.4))

    const group = new THREE.Group()
    scene.add(group)

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xf0f0f0, metalness: 1, roughness: 0.032,
      envMapIntensity: tone === 'dark' ? 2.2 : 1.45, clearcoat: 1, clearcoatRoughness: 0.01
    })
    const accentMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(accent), metalness: 1, roughness: 0.15,
      envMapIntensity: 1.9, clearcoat: 1, clearcoatRoughness: 0.06
    })

    // Central large octahedron
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), mat)
    group.add(core)

    // Orbiting shapes at different distances and angles
    const orbitItems = [
      { geo: new THREE.TetrahedronGeometry(0.38, 0), mat: accentMat, r: 1.9, speed: 1.0,  yOff: 0.3,  phase: 0 },
      { geo: new THREE.OctahedronGeometry(0.28, 0),  mat: mat,       r: 1.6, speed: -0.7, yOff: -0.5, phase: Math.PI * 0.6 },
      { geo: new THREE.IcosahedronGeometry(0.22, 0), mat: accentMat, r: 2.2, speed: 0.55, yOff: 0.6,  phase: Math.PI * 1.2 },
      { geo: new THREE.DodecahedronGeometry(0.3, 0), mat: mat,       r: 1.7, speed: -0.9, yOff: -0.2, phase: Math.PI * 0.3 },
      { geo: new THREE.TetrahedronGeometry(0.26, 0), mat: mat,       r: 2.0, speed: 0.65, yOff: 0.8,  phase: Math.PI * 1.7 },
      { geo: new THREE.OctahedronGeometry(0.2, 0),   mat: accentMat, r: 1.5, speed: -1.2, yOff: 0.1,  phase: Math.PI * 0.9 },
    ]

    const orbiters = orbitItems.map(o => {
      const mesh = new THREE.Mesh(o.geo, o.mat)
      group.add(mesh)
      return { mesh, ...o }
    })

    // Connecting rods between core and orbiters
    orbitItems.forEach((o, idx) => {
      const startX = Math.cos(o.phase) * o.r
      const startZ = Math.sin(o.phase) * o.r
      const len = Math.sqrt(startX * startX + o.yOff * o.yOff + startZ * startZ)
      const rodGeo = new THREE.CylinderGeometry(0.022, 0.022, len, 8)
      const rod = new THREE.Mesh(rodGeo, idx % 3 === 0 ? accentMat : mat)

      rod.position.set(startX / 2, o.yOff / 2, startZ / 2)
      const dir = new THREE.Vector3(startX, o.yOff, startZ).normalize()
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
      group.add(rod)
    })

    // Small floating dots scattered around
    for (let i = 0; i < 14; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 10, 8),
        i % 4 === 0 ? accentMat : mat
      )
      const a = (i / 14) * Math.PI * 2
      const r = 2.6 + Math.random() * 0.6
      dot.position.set(
        Math.cos(a) * r,
        (Math.random() - 0.5) * 2.2,
        Math.sin(a) * r
      )
      group.add(dot)
    }

    let animId, last = performance.now(), t0 = performance.now()
    function loop(t) {
      animId = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (t - last) / 1000); last = t
      if (!visibleRef.current) return

      const elapsed = (t - t0) / 1000
      group.rotation.y += dt * 0.35
      group.rotation.x = Math.sin(elapsed * 0.22) * 0.12
      core.rotation.y += dt * 0.8
      core.rotation.x += dt * 0.3

      orbiters.forEach((o) => {
        const angle = o.phase + elapsed * o.speed
        o.mesh.position.set(Math.cos(angle) * o.r, o.yOff, Math.sin(angle) * o.r)
        o.mesh.rotation.x += dt * 1.1
        o.mesh.rotation.z += dt * 0.7
      })

      renderer.render(scene, camera)
    }
    animId = requestAnimationFrame(loop)

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h; camera.updateProjectionMatrix()
    })
    ro.observe(mount)
    const io = new IntersectionObserver(([e]) => { visibleRef.current = e.isIntersecting }, { threshold: 0 })
    io.observe(mount)

    return () => {
      cancelAnimationFrame(animId); ro.disconnect(); io.disconnect()
      renderer.dispose()
      if (mount.contains(canvas)) mount.removeChild(canvas)
    }
  }, [tone, accent])

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', ...style }} />
}
