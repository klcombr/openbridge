import { loadConfig, networkIp, rotatePin } from './config.mjs';

const cfg = loadConfig();
const pin = rotatePin(cfg);
const ip = networkIp();

console.log(`Endereço : http://${ip}:${cfg.port}`);
console.log(`Token    : ${cfg.token}`);
console.log(`PIN      : ${pin}`);
console.log('Digite token + PIN na tela do openbridge no celular.');
console.log('(o PIN novo vale imediatamente — o servidor relê o config a cada requisição)');
