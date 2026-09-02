export interface DialTarget {
  host: string;
  port: number;
}

export interface Socket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export type EgressVia = "direct" | "chain" | "proxyip" | "nat64";

export interface EgressCandidate {
  via: EgressVia;
  label: string;
  host: string;
  port: number;
}

export interface FailoverStrategy {
  readonly target: DialTarget;
  readonly candidates: readonly EgressCandidate[];
}

export interface EstablishedEgress {
  socket: Socket;
  via: EgressVia;
  candidateIndex: number;
}

export interface EgressOpener {
  open(target: DialTarget, firstPacket: Uint8Array | null): Promise<EstablishedEgress>;
  retry(target: DialTarget, firstPacket: Uint8Array | null): Promise<EstablishedEgress | null>;
}

export type DnsPacketRelay = (rawDnsPacket: Uint8Array) => Promise<Uint8Array | null>;
