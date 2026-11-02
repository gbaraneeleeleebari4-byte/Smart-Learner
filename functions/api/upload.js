
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DBBYTE_API_KEY) {
      return Response.json(
        { error: "Storage is not configured." },
        { status: 500 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");

    if (!file || typeof file.arrayBuffer !== "function") {
      return Response.json(
        { error: "Please select a file." },
        { status: 400 }
      );
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf"
    ];

    if (!allowedTypes.includes(file.type)) {
      return Response.json(
        { error: "Only images and PDF files are allowed." },
        { status: 415 }
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return Response.json(
        { error: "File must be 10 MB or smaller." },
        { status: 413 }
      );
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedName = `${crypto.randomUUID()}-${safeName}`;

    const uploadForm = new FormData();
    uploadForm.append("file", file, storedName);

    const response = await fetch(
      "https://api.dbbyte.com/storage/my-first-bucket/upload",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.DBBYTE_API_KEY}`
        },
        body: uploadForm
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: result.error || "Upload failed." },
        { status: response.status }
      );
    }

    return Response.json({
      success: true,
      name: result.name || storedName,
      key: result.key,
      mimeType: result.mimeType,
      size: result.size
    });

  } catch (error) {
    return Response.json(
      { error: "Something went wrong while uploading." },
      { status: 500 }
    );
  }
}
