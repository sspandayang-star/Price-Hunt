import type { SearchResult } from "./scoring";

// A real search from 23 Oct 2026, shown until you run your first search.
export const EXAMPLE: SearchResult = {
  example: true,
  query: "Sony WH-1000XM5",
  includeUsed: false,
  at: "2026-10-23T06:20:00+08:00",
  product: "Sony WH-1000XM5 wireless noise-cancelling headphones",
  assumption: null,
  marketRef: { low: 349, high: 409, source: "Singapore price roundup covering Shopee, Lazada, Amazon SG, Challenger, Courts and Harvey Norman" },
  listings: [
    {
      store: "iShopChangi", seller: "Fulfilled by Sony Singapore", title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
      url: "https://www.ishopchangi.com/en/product/sony-wh-1000xm5-wireless-noise-cancelling-headphones-mp00175642",
      price: 301.83, originalPrice: 540.37, shipping: null, condition: "new", sellerType: "official", rating: null, reviewCount: null, soldCount: null,
      warranty: "unknown", warrantyNote: null, returns: "30-day refund", buyerProtection: true, inStock: true, priceDate: "2026-10-19",
      note: "Lowest price shown is for collection at Changi departure. Check the Delivery in SG price if you aren't flying.",
    },
    {
      store: "Sony Store Singapore", seller: "Sony Electronics (Singapore)", title: "WH-1000XM5 Wireless Noise Cancelling Headphones (Smoky Pink)",
      url: "https://www.sony.com.sg/electronics/headband-headphones/wh-1000xm5",
      price: 329, originalPrice: 589, shipping: null, condition: "new", sellerType: "official", rating: 4.4, reviewCount: 2526, soldCount: null,
      warranty: "local", warrantyNote: null, returns: null, buyerProtection: false, inStock: true, priceDate: "2026-08-25",
      note: "S$329 is the Smoky Pink colour; other colours may cost more. Rating is for the product.",
    },
    {
      store: "Shopee", seller: "Metapod Official Store", title: "Sony Singapore WH-1000XM5 Wireless Noise Cancelling Headphones",
      url: "https://biggo.sg/s/xm5%20sony%20headphones",
      price: 589, originalPrice: null, shipping: null, condition: "new", sellerType: "mall_seller", rating: null, reviewCount: null, soldCount: null,
      warranty: "local", warrantyNote: "Sony Singapore set", returns: null, buyerProtection: true, inStock: true, priceDate: null,
      note: "Listed at full retail price; seen via a BigGo price page.",
    },
  ],
  warnings: [],
};
