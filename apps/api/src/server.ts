import { app } from './app.js';
import { env } from './config/env.js';
app.listen(env.API_PORT, () => console.log(`API disponible en el puerto ${env.API_PORT}`));
