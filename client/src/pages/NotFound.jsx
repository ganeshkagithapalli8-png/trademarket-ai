import { Link } from 'react-router-dom';
import { Button, Logo } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="text-center">
        <Logo className="mx-auto h-12 w-12" />
        <p className="mt-5 text-[56px] font-extrabold leading-none tracking-tight text-slate-200">404</p>
        <h1 className="mt-2 text-[20px] font-bold text-slate-900">That page does not exist</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-slate-500">
          The link may be old, or the page may have moved. Head back to your dashboard to pick up where you left off.
        </p>
        <div className="mt-6 flex justify-center gap-2.5">
          <Link to="/app"><Button icon="home">Dashboard</Button></Link>
          <Link to="/"><Button variant="secondary">Home</Button></Link>
        </div>
      </div>
    </div>
  );
}
