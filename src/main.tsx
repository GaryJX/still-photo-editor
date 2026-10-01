import { render } from 'preact';
import { App } from './app/App';
import './styles/app.css';
import './styles/theme.css';

render(<App />, document.getElementById('app')!);
