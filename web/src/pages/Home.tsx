import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Feature card component
function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string
  description: string
  icon: string
}) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
      <div className="mb-3 text-3xl">{icon}</div>
      <h3 className="mb-2 text-lg font-semibold text-white">{title}</h3>
      <p className="text-sm text-gray-400">{description}</p>
    </div>
  )
}

// Step card component
function StepCard({
  number,
  title,
  description,
}: {
  number: number
  title: string
  description: string
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">
        {number}
      </div>
      <div>
        <h4 className="font-semibold text-white">{title}</h4>
        <p className="text-sm text-gray-400">{description}</p>
      </div>
    </div>
  )
}

export function Home() {
  const navigate = useNavigate()
  const [showSlideModal, setShowSlideModal] = useState(false)
  const [slideId, setSlideId] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Navigate to demo session
  const handleTryDemo = useCallback(() => {
    navigate('/s/demo')
  }, [navigate])

  // Create a new session with the specified slide
  const handleCreateSession = useCallback(() => {
    if (slideId.trim()) {
      setIsLoading(true)
      // Navigate to a new session - the session page will handle creation
      navigate(`/s/new?slide=${encodeURIComponent(slideId.trim())}`)
    }
  }, [navigate, slideId])

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Hero Section */}
      <header className="border-b border-gray-800">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-white">PathCollab</h1>
            <nav className="flex gap-4">
              <a
                href="https://github.com/your-org/pathcollab"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-400 hover:text-white"
              >
                GitHub
              </a>
              <a href="#features" className="text-sm text-gray-400 hover:text-white">
                Features
              </a>
              <a href="#how-it-works" className="text-sm text-gray-400 hover:text-white">
                How It Works
              </a>
            </nav>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Content */}
        <section className="py-20 text-center">
          <div className="mx-auto max-w-4xl px-4">
            <h2 className="mb-4 text-5xl font-bold text-white">Collaborative Pathology Viewer</h2>
            <p className="mb-8 text-xl text-gray-400">
              Real-time multi-user sessions for viewing and annotating whole-slide images with
              AI-generated overlays. Share a link and collaborate instantly - no accounts required.
            </p>
            <div className="flex justify-center gap-4">
              <button
                onClick={handleTryDemo}
                className="rounded-lg bg-blue-600 px-8 py-3 text-lg font-semibold text-white transition hover:bg-blue-700"
              >
                Try Demo
              </button>
              <button
                onClick={() => setShowSlideModal(true)}
                className="rounded-lg border border-gray-600 bg-gray-800 px-8 py-3 text-lg font-semibold text-white transition hover:bg-gray-700"
              >
                Create Session
              </button>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="border-t border-gray-800 py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h3 className="mb-12 text-center text-3xl font-bold text-white">Features</h3>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon="👥"
                title="Real-time Collaboration"
                description="Up to 20 users can view the same slide simultaneously. See everyone's cursor position in real-time."
              />
              <FeatureCard
                icon="🎯"
                title="Presenter-Led Sessions"
                description="The presenter controls navigation while followers can snap to their view or explore independently."
              />
              <FeatureCard
                icon="🔬"
                title="AI Overlay Support"
                description="Upload cell segmentation and tissue classification overlays. Visualize millions of polygons with WebGL2."
              />
              <FeatureCard
                icon="⚡"
                title="High Performance"
                description="Sub-second tile loading with intelligent prefetching. Smooth 60fps rendering even with complex overlays."
              />
              <FeatureCard
                icon="🔗"
                title="Zero-Auth Sessions"
                description="Share a link and collaborators can join instantly. No accounts, no passwords - just pathology."
              />
              <FeatureCard
                icon="🐳"
                title="Self-Hostable"
                description="Run your own instance with a single docker-compose command. Your data stays on your servers."
              />
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="border-t border-gray-800 py-16">
          <div className="mx-auto max-w-4xl px-4">
            <h3 className="mb-12 text-center text-3xl font-bold text-white">How It Works</h3>
            <div className="space-y-8">
              <StepCard
                number={1}
                title="Start a Session"
                description="Click 'Create Session' and select a slide from your WSI collection. You become the presenter."
              />
              <StepCard
                number={2}
                title="Share the Link"
                description="Copy the session URL and share it with your team. The link contains secure tokens for joining."
              />
              <StepCard
                number={3}
                title="Collaborate in Real-time"
                description="Navigate the slide, upload AI overlays, and discuss findings. Everyone sees cursor positions and viewport changes instantly."
              />
              <StepCard
                number={4}
                title="Explore and Annotate"
                description="Toggle tissue heatmaps and cell polygons. Hover over cells to see classification details. Followers can explore independently or snap back to the presenter's view."
              />
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="border-t border-gray-800 py-16">
          <div className="mx-auto max-w-4xl px-4 text-center">
            <h3 className="mb-4 text-2xl font-bold text-white">Ready to Get Started?</h3>
            <p className="mb-8 text-gray-400">
              Try the demo with a sample slide or set up your own instance.
            </p>
            <div className="flex justify-center gap-4">
              <button
                onClick={handleTryDemo}
                className="rounded-lg bg-blue-600 px-6 py-2 font-semibold text-white transition hover:bg-blue-700"
              >
                Try Demo
              </button>
              <a
                href="https://github.com/your-org/pathcollab#quick-start"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-gray-600 bg-gray-800 px-6 py-2 font-semibold text-white transition hover:bg-gray-700"
              >
                Self-Host Guide
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-gray-500">
          <p>PathCollab - Open Source Collaborative Pathology Viewer</p>
          <p className="mt-1">
            <a
              href="https://github.com/your-org/pathcollab"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-400"
            >
              View on GitHub
            </a>
            {' | '}
            <a href="/s/demo" className="hover:text-gray-400">
              Try Demo
            </a>
            {' | '}
            <a
              href="https://github.com/your-org/pathcollab/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-400"
            >
              Report Issue
            </a>
          </p>
        </div>
      </footer>

      {/* Create Session Modal */}
      {showSlideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-lg bg-gray-800 p-6">
            <h4 className="mb-4 text-lg font-semibold text-white">Create New Session</h4>
            <div className="mb-4">
              <label htmlFor="slideId" className="mb-2 block text-sm text-gray-400">
                Slide ID
              </label>
              <input
                id="slideId"
                type="text"
                value={slideId}
                onChange={(e) => setSlideId(e.target.value)}
                placeholder="e.g., tcga-brca-001"
                className="w-full rounded border border-gray-600 bg-gray-700 px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                Enter the ID of a slide available in your WSIStreamer instance.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSlideModal(false)}
                className="rounded px-4 py-2 text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSession}
                disabled={!slideId.trim() || isLoading}
                className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isLoading ? 'Creating...' : 'Create Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
