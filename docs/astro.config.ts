import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';

const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig({
  site: 'https://roombarr.github.io',
  base: '/roombarr/',
  integrations: [
    starlight({
      title: 'Roombarr',
      description: 'Rule-based media cleanup engine for the *arr stack.',
      plugins: [starlightLlmsTxt(), starlightLinksValidator()],
      editLink: {
        baseUrl: 'https://github.com/roombarr/roombarr/edit/main/docs/',
      },
      lastUpdated: true,
      head: isProduction
        ? [
            {
              tag: 'script',
              content:
                '!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init("phc_AshSHyHc47ileT26Vn7DFVl61gk8mafE08aXJhM1acu",{api_host:"https://us.i.posthog.com", defaults:"2026-01-30"})',
            },
          ]
        : [],
      favicon: '/favicon.svg',
      customCss: [
        '@fontsource-variable/inter',
        '@fontsource-variable/jetbrains-mono',
        './src/styles/global.css',
        './src/styles/custom.css',
      ],
      sidebar: [
        { slug: 'getting-started' },
        {
          label: 'Usage',
          items: [
            { slug: 'configuration' },
            { slug: 'recipes' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'api' },
            { slug: 'reference' },
          ],
        },
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/roombarr/roombarr',
        },
      ],
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
