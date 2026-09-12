import { redirect } from "next/navigation";

/** The product lives under /admin; the root is just the way in. */
export default function Root() {
  redirect("/admin");
}
