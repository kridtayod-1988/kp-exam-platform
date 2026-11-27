/* Public configuration only. Never place secrets, private keys, or service tokens here. */
(() => {
  const host = window.location.hostname;
  const isProduction = host === 'kp-exam-platform.kridtayod.workers.dev';
  window.KP_CONFIG = {
    appName: 'KP e-Exam Platform',
    apiBaseUrl: isProduction
      ? 'https://kp-exam-api.kridtayod.workers.dev'
      : 'https://kp-exam-api-staging.kridtayod.workers.dev',
    authEnabled: true,
    demoMode: false
  };
})();
