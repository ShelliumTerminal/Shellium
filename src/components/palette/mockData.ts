import type { Folder } from "./types";

export const mockData: Folder[] = [
  {
    id: "production",
    name: "Production",
    folders: [
      {
        id: "production-oracle",
        name: "Oracle",
        hosts: [
          {
            id: "prod-ora01",
            name: "PROD-ORA01",
            hostname: "10.10.1.11",
            port: 22,
            username: "oracle",
            description: "Primary production Oracle host",
            tags: ["prod", "oracle"],
          },
          {
            id: "prod-ora02",
            name: "PROD-ORA02",
            hostname: "10.10.1.12",
            port: 22,
            username: "oracle",
            description: "Standby production Oracle host",
            tags: ["prod", "oracle"],
          },
        ],
      },
    ],
  },
  {
    id: "test",
    name: "Test",
    folders: [
      {
        id: "test-oracle",
        name: "Oracle",
        hosts: [
          {
            id: "test01",
            name: "TEST01",
            hostname: "10.20.1.21",
            port: 22,
            username: "tester",
            description: "Shared test host",
            tags: ["test", "oracle"],
          },
        ],
      },
    ],
  },
];
