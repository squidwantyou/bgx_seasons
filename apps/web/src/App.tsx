import { Link, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { Lobby } from './pages/Lobby';
import { MatchPage } from './pages/MatchPage';
import { ProfilePage } from './pages/ProfilePage';

function NotFound() {
  return (
    <div className="page">
      <div className="notice-card">
        <p className="eyebrow">404</p>
        <h1>走错地方了</h1>
        <p className="muted">这个页面不存在，回大厅开一局吧。</p>
        <Link to="/" className="btn btn-primary">
          回到大厅
        </Link>
      </div>
    </div>
  );
}

export function App() {
  return (
    <div className="app">
      <Header />
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/m/:matchId" element={<MatchPage />} />
        <Route path="/p/:userId" element={<ProfilePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <footer className="site-footer">
        <span>BGX · 单服务器部署</span>
        <span className="footer-dot" aria-hidden>
          ·
        </span>
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
          京ICP备2025114848号-1
        </a>
      </footer>
    </div>
  );
}
