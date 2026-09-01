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

export default function Brain3D({ tone = 'dark', accent = '#ec3013', style }) {
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
    camera.position.z = 3

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
    keyLight.position.set(4, 6, 5)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.7)
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
    const lineMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(accent), metalness: 0.8, roughness: 0.25, envMapIntensity: 1.2
    })

    const brainL = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 5), mat)
    brainL.position.set(-0.35, 0, 0); brainL.scale.set(1, 1.1, 0.95)
    group.add(brainL)

    const brainR = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 5), mat)
    brainR.position.set(0.35, 0, 0); brainR.scale.set(1, 1.1, 0.95)
    group.add(brainR)

    const ccGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.28, 16)
    ccGeo.rotateZ(Math.PI / 2)
    const cc = new THREE.Mesh(ccGeo, mat)
    cc.position.set(0, -0.1, 0)
    group.add(cc)

    const nodes = []
    for (let i = 0; i < 24; i++) {
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), accentMat)
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI
      const r = 0.65 + Math.random() * 0.3
      const side = Math.random() > 0.5 ? -1 : 1
      node.position.set(
        side * (0.35 + r * Math.cos(a) * Math.sin(b)),
        r * Math.cos(b) - 0.1,
        r * Math.sin(a) * Math.sin(b)
      )
      group.add(node)
      nodes.push(node.position)
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < Math.min(i + 3, nodes.length); j++) {
        const d = nodes[i].distanceTo(nodes[j])
        if (d < 1.2) {
          const lineGeo = new THREE.CylinderGeometry(0.012, 0.012, d, 6)
          const line = new THREE.Mesh(lineGeo, lineMat)
          const mid = new THREE.Vector3().addVectors(nodes[i], nodes[j]).multiplyScalar(0.5)
          line.position.copy(mid)
          const dir = new THREE.Vector3().subVectors(nodes[j], nodes[i])
          line.rotation.z = Math.atan2(dir.y, Math.hypot(dir.x, dir.z))
          line.rotation.x = Math.atan2(dir.z, dir.x)
          group.add(line)
        }
      }
    }

    let animId, last = performance.now(), frame = 0
    function loop(t) {
      animId = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (t - last) / 1000); last = t; frame++
      if (!visibleRef.current) return
      group.rotation.y += dt * 0.4
      group.rotation.x = Math.sin(frame * 0.0003) * 0.15
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
