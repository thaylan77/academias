import "@testing-library/jest-dom";

// waitFor e findBy esperam até 5 s (o padrão é 1 s). Ver testTimeout no vite.config.ts.
import { configure } from "@testing-library/react";
configure({ asyncUtilTimeout: 5000 });
