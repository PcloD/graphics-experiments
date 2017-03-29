namespace Simulation {
    const vecAllocator = {
        allocate(): Vec2 { return Vec2.allocateFromPool() },
        release(v: Vec2): void { v.returnToPool() }
    }

    const Position = new ComponentType("Position", vecAllocator)
    const Velocity = new ComponentType("Velocity", vecAllocator)

    function moveSystem(context: Context) {
        const group = context.createGroupWith(Position, Velocity)
        const dp = new Vec2
        return function move(dt: number) {
            group.each((p, v) => {
                // dp = v dt
                dp.copyFrom(v)
                dp.scale(dt)
                p.add(dp)
            })
        }
    }

    class RigidBodyInfo {
        force: Vec2 = new Vec2()
        mass: number = 1.0
        clear() { this.force.clear(); this.mass = 1.0 }
    }
    const RigidBody = new ComponentType("RigidBody", new PoolAllocator(RigidBodyInfo))

    function accelerationSystem(context: Context) {
        const group = context.createGroupWith(Velocity, RigidBody)
        const dv = new Vec2
        return function accelerate(dt: number) {
            group.each((v, body) => {
                // dv = a dt = F/m dt
                dv.copyFrom(body.force)
                dv.scale(dt / body.mass)
                v.add(dv)
                body.force.clear()
            })
        }
    }

    function gravitySystem(context: Context) {
        const group = context.createGroupWith(RigidBody)
        const df = new Vec2
        return function applyGravity() {
            group.each((body, entity) => {
                df.set(0, -9.8)
                df.scale(body.mass)
                body.force.add(df)
                // df = -9.8 * m [down]
            })
        }
    }

    const RAINDROP_MASS = 0.004 // kg
    const GRAVITY = 9.8 // m/s^2
    const TERMINAL_VELOCITY = 10.0 // m/s
    const TERMINAL_VELOCITY2 = TERMINAL_VELOCITY * TERMINAL_VELOCITY

    function dragSystem(context: Context) {
        const group = context.createGroupWith(Velocity, RigidBody)
        const df = new Vec2
        const dragFactor = (RAINDROP_MASS * GRAVITY) / TERMINAL_VELOCITY2
        return function applyDrag() {
            group.each((v, body, entity) => {
                df.copyFrom(v)
                df.scale(-dragFactor * v.length())
                body.force.add(df)
                // df = -dragFactor * v
            })
        }
    }

    function recycleParticlesSystem(context: Context, width: number, height: number) {
        const toRecycle: Entity[] = []
        const group = context.createGroupWith(Position, ParticleAppearance)
        return function recycleParticlesSystem(dt: number) {
            group.each((position, _, entity) => {
                if (position.x < 0 || position.x >= width || position.y < 0) {
                    resetParticle(entity)
                }
            })
        }
    }

    /**
     * Render particles
     */
    class ParticleAppearanceInfo {
        radius: number
        color: string
        set(radius: number, color: string) { this.radius = radius; this.color = color }
    }
    const ParticleAppearance = new ComponentType("ParticleAppearance", new PoolAllocator(ParticleAppearanceInfo))

    function particleRenderSystem(context: Context, ctx: CanvasRenderingContext2D, width: number, height: number) {
        const PIXELS_PER_METER = 100
        const group = context.createGroupWith(Position, ParticleAppearance)
        return function renderParticles() {
            group.each((p, appearance) => {
                ctx.fillStyle = appearance.color
                ctx.fillRect(p.x * PIXELS_PER_METER, height - p.y * PIXELS_PER_METER, appearance.radius, appearance.radius)
            })
        }
    }

    function resetParticle(entity: Entity): void {
        entity.get(Position).set(Math.random() * 6, 6)
        entity.get(Velocity).set(0, -5 - Math.random() * 5) // Random speed between 5m/s and 10m/s down
        const rigidBody = entity.get(RigidBody)
        rigidBody.clear()
        rigidBody.mass = 0.004 // kg
        entity.get(ParticleAppearance).set(2, "rgb(100, 100, 200)")
    }

    /**
     * Bounce particles off of umbrella
     */
    function particleBounceSystem(context: Context) {
        const group = context.createGroupWith(Position, Velocity, ParticleAppearance)
        const umbrellaCenter = new Vec2(3, 1)
        const radius = 1
        const r2 = radius * radius
        const v1 = new Vec2()
        const n = new Vec2()
        const e = 0.2  // coefficient of restititution
        const e2 = e * e
        return function bounceParticles(dt: number) {
            group.each((p, v, appearance) => {
                // n = p - center
                n.copyFrom(p)
                n.subtract(umbrellaCenter)
                if (n.length2() < r2 && n.dot(v) < 0) {
                    // Collision!

                    // Solve for the collision impulse effect
                    const a = n.length2()
                    const b = 2 * v.dot(n)
                    const c = (1 - e2) * v.length2()

                    // The coefficient of restitution is not always
                    // satisfiable. In those cases, setting the determinant to
                    // zero has the same effect as using the maximum possible
                    // coefficient of restitution.
                    const det = Math.max(0, b*b - 4 * a * c)
                    const k = (-b + Math.sqrt(det)) / (2 * a)

                    v1.copyFrom(n)
                    v1.scale(k)
                    v1.add(v)

                    // Update!
                    v.copyFrom(v1)
                    
                    // Correct position to be at the surface of the umbrella
                    p.copyFrom(n)
                    p.scale(radius / n.length())
                    p.add(umbrellaCenter)
                }
            })
        }
    }

    /**
     * Generate new particle
     */
    function createParticle(context: Context, width: number, height: number): void {
        const entity = context.createEntity()
        entity.add(Position)
        entity.add(Velocity)
        entity.add(RigidBody)
        entity.add(ParticleAppearance)
        resetParticle(entity)
    }

    function startTick(cb: () => void) {
        // Chrome seems to leak memory from requestAnimationFrame loops.
        // https://bugs.chromium.org/p/chromium/issues/detail?id=120186
        (function tick() {
            cb()
            requestAnimationFrame(tick)
        })()
    }

    export function main() {
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d")!
        document.body.appendChild(canvas)
        const width = 600
        const height = 600
        canvas.width = width
        canvas.height = height

        const simContext = new Context()

        // Set up systems
        const recycleParticles = recycleParticlesSystem(simContext, 6, 6)
        const applyGravity = gravitySystem(simContext)
        const applyDrag = dragSystem(simContext)
        const accelerate = accelerationSystem(simContext)
        const move = moveSystem(simContext)
        const bounceParticles = particleBounceSystem(simContext)
        const renderParticles = particleRenderSystem(simContext, ctx, width, height)

        function tick() {
            if (simContext.entities.length < 2000) {
                createParticle(simContext, width, height)
            }
            const dt = 1/60.0

            recycleParticles(dt)
            applyGravity()
            applyDrag()
            accelerate(dt)
            move(dt)
            bounceParticles(dt)

            ctx.fillStyle = 'black'
            ctx.fillRect(0, 0, width, height)

            // Draw the umbrella
            /*
            ctx.fillStyle = 'rgb(30, 30, 30)'
            ctx.beginPath()
            ctx.ellipse(400, 600, 100, 100, 0, 0, 2 * Math.PI)
            ctx.fill()
            */

            renderParticles()

        }
        startTick(tick)
    }
}