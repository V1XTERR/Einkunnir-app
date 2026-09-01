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

function makeHand(THREE, side, mat, accentMat) {
  const g = new THREE.Group()

  // Wrist
  const wristGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.4, 16)
  wristGeo.rotateZ(Math.PI / 2)
  g.add(new THREE.Mesh(wristGeo, mat))

  // Palm
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.18), mat)
  palm.position.set(side === 'left' ? -0.2 : 0.2, 0.22, 0)
  g.add(palm)

  // Fingers
  const fingers = [
    { x: -0.34, y: 0.56, rot: -0.3 },
    { x: side === 'left' ? -0.18 : -0.06, y: 0.58, rot: -0.08 },
    { x: side === 'left' ? 0.02 : 0.06, y: 0.62, rot: 0.04 },
    { x: side === 'left' ? 0.2 : 0.18, y: 0.58, rot: 0.12 },
    { x: side === 'left' ? 0.36 : 0.32, y: 0.52, rot: 0.2 },
  ]

  for (const f of fingers) {
    const fGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.42, 14)
    fGeo.rotateZ(Math.PI / 2)
    const finger = new THREE.Mesh(fGeo, mat)
    finger.position.set(f.x, f.y, 0)
    finger.rotation.z = f.rot
    g.add(finger)

    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 12), mat)
    knuckle.position.set(f.x + 0.15 * Math.cos(f.rot), f.y + 0.15 * Math.sin(f.rot), 0)
    g.add(knuckle)
  }

  // Accent veins
  const veins = [
    { from: [0, 0, 0], to: [-0.32, 0.4, 0] },
    { from: [0, 0, 0], to: [0, 0.42, 0] },
    { from: [0, 0, 0], to: [0.32, 0.4, 0] },
  ]
  for (const v of veins) {
    const len = Math.hypot(v.to[0] - v.from[0], v.to[1] - v.from[1])
    const vGeo = new THREE.CylinderGeometry(0.008, 0.008, len, 6)
    const vein = new THREE.Mesh(vGeo, accentMat)
    vein.position.set((v.from[0] + v.to[0]) / 2, (v.from[1] + v.to[1]) / 2, v.from[2])
    vein.rotation.z = Math.atan2(v.to[1] - v.from[1], v.to[0] - v.from[0])
    g.add(vein)
  }

  return g
}

export default function Hands3D({ tone = 'dark', accent = '#ec3013', style }) {
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

    const camera = new THREE.PerspectiveCamera(75, W / H, 0.1, 100)
    camera.position.z = 3.2

    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(5, 8, 6)
    const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-4, -3, 4)
    scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.5))

    const group = new THREE.Group()
    scene.add(group)

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xf5f5f5, metalness: 1, roughness: 0.028,
      envMapIntensity: tone === 'dark' ? 2.3 : 1.5, clearcoat: 1, clearcoatRoughness: 0.008
    })
    const accentMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(accent), metalness: 1, roughness: 0.18, envMapIntensity: 1.8
    })

    const lhand = makeHand(THREE, 'left', mat, accentMat)
    lhand.position.set(-1.2, 0.4, 0); lhand.rotation.z = -0.3; lhand.rotation.x = -0.2
    group.add(lhand)

    const rhand = makeHand(THREE, 'right', mat, accentMat)
    rhand.position.set(1.4, -0.6, -0.3); rhand.rotation.z = 0.25; rhand.rotation.x = 0.15
    group.add(rhand)

    let animId
    let last = performance.now()
    let frame = 0
    function loop(t) {
      animId = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (t - last) / 1000); last = t
      frame++
      if (!visibleRef.current) return
      group.rotation.y += dt * 0.5
      renderer.render(scene, camera)
    }
    animId = requestAnimationFrame(loop)

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    const io = new IntersectionObserver(([e]) => { visibleRef.current = e.isIntersecting }, { threshold: 0 })
    io.observe(mount)

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect(); io.disconnect()
      renderer.dispose()
      if (mount.contains(canvas)) mount.removeChild(canvas)
    }
  }, [tone, accent])

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', ...style }} />
}
