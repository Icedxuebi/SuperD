import Image from "next/image";

export default function Home() {
  return (
    <div className="flex items-center justify-center gap-8 py-20 flex-wrap">
      <h1 className="text-5xl font-bold text-slate-900 tracking-tight">
        Work in progress
      </h1>
      <Image
        src="/landing.gif"
        alt=""
        width={240}
        height={240}
        unoptimized
        priority
        className="h-40 w-auto"
      />
    </div>
  );
}
