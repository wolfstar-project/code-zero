import { dehydrate, hydrate, QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

/**
 * The `QueryClient` `$orpcQuery`'s `.queryOptions()`/`.mutationOptions()` results are consumed
 * against — without this, `useQuery`/`useMutation` throw for lacking one, no matter how correctly
 * `orpc.client.ts`/`orpc.server.ts` built the underlying oRPC client.
 *
 * SSR hydration follows TanStack Query's own documented Nuxt pattern: `useState` shares one slot
 * between the server render and the client takeover, `app:rendered` serialises whatever the render
 * fetched into it, and `app:created` replays that into the client's own `QueryClient` before the
 * app mounts — so hydration reuses the server's queries instead of re-fetching everything once the
 * client boots.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const vueQueryState = useState('vue-query');
  const queryClient = new QueryClient();
  nuxtApp.vueApp.use(VueQueryPlugin, { queryClient });

  if (import.meta.server) {
    nuxtApp.hooks.hook('app:rendered', () => {
      vueQueryState.value = dehydrate(queryClient);
    });
  }

  if (import.meta.client) {
    nuxtApp.hooks.hook('app:created', () => {
      hydrate(queryClient, vueQueryState.value);
    });
  }
});
