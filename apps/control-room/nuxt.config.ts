export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  devtools: {
    enabled: false,
  },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  telemetry: false,
  typescript: {
    strict: true,
    typeCheck: true,
  },
  runtimeConfig: {
    controlRoomApiBaseUrl: '',
    public: {
      controlRoomOrigin: '',
    },
  },
  routeRules: {
    '/**': {
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'x-robots-tag': 'noindex, nofollow',
      },
    },
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'ru',
      },
      title: 'Control Room — Ястройка',
      meta: [
        {
          name: 'description',
          content: 'Операционный интерфейс AI-завода Ястройки.',
        },
        {
          name: 'robots',
          content: 'noindex, nofollow',
        },
      ],
    },
  },
});
