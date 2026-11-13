/** Shared wording for "we couldn't reach that service" — so every card says it the same way. */
export const NO_NETWORK = (service: string) =>
  `Couldn't reach ${service} from the server. The internet connection may be down, or the place this app is hosted may block outside connections. Anything you saved stays saved — try the test again later.`;
