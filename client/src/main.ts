import './styles.css';
import { App } from './App';

const container = document.getElementById('app');
if (!container) throw new Error('#app element missing in index.html');

new App(container).start();
