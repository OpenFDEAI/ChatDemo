import { loadTheme } from "@/lib/theme";
import { DEFAULT_ANCHOR, generateTickets } from "@/data/seed";
import Workbench from "@/modules/workbench";

export default function Page() {
  const theme = loadTheme();
  // Deterministic dataset generated on the server and passed down as props.
  const tickets = generateTickets();
  return <Workbench theme={theme} tickets={tickets} anchor={DEFAULT_ANCHOR} />;
}
