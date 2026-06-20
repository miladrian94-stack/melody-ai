import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    success: true,
    message: "Studio preview endpoint is active",
  });
}

export async function GET() {
  return NextResponse.json({
    success: true,
    preview: null,
  });
}
