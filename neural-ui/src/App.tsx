import { Routes, Route, Link, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Training from './pages/Training';
import Deals from './pages/Deals';
import DealDetail from './pages/DealDetail';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/training', label: 'Training', icon: '🧠' },
  { path: '/deals', label: 'Deals', icon: '💰' },
];

function App() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔮</span>
              <h1 className="text-xl font-bold text-gray-900">Neural Training UI</h1>
            </div>
            <nav className="flex gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname === item.path
                      ? 'bg-neural-primary text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className="mr-1">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/training" element={<Training />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/deals/:id" element={<DealDetail />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
