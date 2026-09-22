import Image from 'next/image'

// Shared by the content-heavy marketing pages (Product/Use Cases/Pricing/
// About) — reuses the app's colorful gradient-blur backgrounds rather than
// the homepage's sticker collage, since long-form text needs a calmer
// backdrop than a busy collage.
export function PageBackground() {
  return (
    <>
      <Image
        src="/images/AppDesktopBackground.PNG"
        alt=""
        fill
        priority
        sizes="100vw"
        className="hidden object-cover md:block"
        aria-hidden
      />
      <Image
        src="/images/AppIphoneBackground.PNG"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover md:hidden"
        aria-hidden
      />
    </>
  )
}
