import { createFileRoute } from "@tanstack/react-router";
import { OptionsPage } from "@/components/OptionsPage";

export const Route = createFileRoute("/_authenticated/calls")({
  component: () => <OptionsPage kind="CALL" />,
});
