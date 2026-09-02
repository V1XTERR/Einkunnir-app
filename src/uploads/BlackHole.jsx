import { useEffect, useRef } from 'react'
import * as THREE from 'three'

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

export default function BlackHole({
  tone         = 'dark',
  accent       = '#00d4ff',
  speed        = 1.2,
  lobeIntensity = 0.6,
  style,
}) {
  const mountRef  = useRef(null)
  const visibleRef = useRef(true)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const W = mount.clientWidth  || 400
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

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100)

    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 5, 6)
    const rim = new THREE.DirectionalLight(0xffffff, 1.4); rim.position.set(-5, -2, -4)
    scene.add(key, rim)

    const envTex = makeEnvTexture(THREE, tone)
    scene.environment = envTex

    const group = new THREE.Group()
    scene.add(group)

    // Warped icosahedron brain core
    const brainGeo = new THREE.IcosahedronGeometry(1.2, 5)
    const positions = brainGeo.attributes.position
    const pos = positions.array
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i+1], z = pos[i+2]
      const len = Math.sqrt(x*x + y*y + z*z)
      const nx = x/len, ny = y/len, nz = z/len
      const warp = Math.sin(nx * 4) * 0.15 + Math.sin(ny * 3) * 0.12 + Math.sin(nz * 5) * 0.1
      pos[i] = nx * (1 + warp)
      pos[i+1] = ny * (1 + warp)
      pos[i+2] = nz * (1 + warp)
    }
    positions.needsUpdate = true
    brainGeo.computeVertexNormals()

    const brainMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 1,
      roughness: 0.035,
      envMapIntensity: tone === 'dark' ? 2.2 : 1.45,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    })
    const brain = new THREE.Mesh(brainGeo, brainMat)
    group.add(brain)

    // Orbiting lobes
    const lobeCount = 8
    for (let i = 0; i < lobeCount; i++) {
      const angle = (i / lobeCount) * Math.PI * 2
      const x = Math.cos(angle) * 1.4
      const y = Math.sin(angle * 0.6) * 0.8
      const z = Math.sin(angle) * 1.4

      const lobeGeo = new THREE.SphereGeometry(0.35, 20, 20)
      const color = new THREE.Color(accent)
      const t = i / lobeCount
      color.getHSL({ h: t * 0.3, s: 0.8, l: 0.5 })

      const lobeMat = new THREE.MeshPhysicalMaterial({
        color,
        metalness: 1,
        roughness: 0.14,
        emissive: color,
        emissiveIntensity: lobeIntensity,
        envMapIntensity: 1.9,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
      })
      const lobe = new THREE.Mesh(lobeGeo, lobeMat)
      lobe.position.set(x, y, z)
      lobe.userData.angle = angle
      group.add(lobe)
    }

    group.rotation.x = -0.2
    group.rotation.z = 0.1

    function positionCamera(w, h) {
      const aspect = w / h
      camera.position.set(0, 1.8, Math.max(8, 5 / Math.max(0.5, aspect)))
      camera.lookAt(0, 0, 0)
      camera.aspect = aspect
      camera.updateProjectionMatrix()
    }
    positionCamera(W, H)

    let animId
    let last = performance.now()
    function loop(t) {
      animId = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      if (!visibleRef.current) return

      brain.rotation.x += (Math.PI * 2 / 20) * dt * speed
      brain.rotation.z += (Math.PI * 2 / 25) * dt * speed * 0.6

      group.children.forEach((child, idx) => {
        if (idx > 0) {
          const angle = child.userData.angle + (t * speed / 2000)
          child.position.x = Math.cos(angle) * 1.4
          child.position.y = Math.sin(angle * 0.6) * 0.8 + Math.sin(t / 3000) * 0.2
          child.position.z = Math.sin(angle) * 1.4
          child.rotation.x += dt * speed
          child.rotation.y += dt * speed * 0.7
        }
      })

      group.rotation.y += (Math.PI * 2 / 120) * dt * speed * 0.05
      group.position.y = Math.sin(t / 5000) * 0.1

      renderer.render(scene, camera)
    }
    animId = requestAnimationFrame(loop)

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight
      renderer.setSize(w, h, false)
      positionCamera(w, h)
    })
    ro.observe(mount)

    const io = new IntersectionObserver(([e]) => { visibleRef.current = e.isIntersecting }, { threshold: 0 })
    io.observe(mount)

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
      io.disconnect()
      renderer.dispose()
      if (mount.contains(canvas)) mount.removeChild(canvas)
    }
  }, [tone, accent, speed, lobeIntensity])

  return (
    <div
      ref={mountRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', ...style }}
    />
  )
}
