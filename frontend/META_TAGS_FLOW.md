# Social Meta Tags Flow Diagram

## Component Lifecycle Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Action                              │
│              Navigate to /bounties/bounty-123                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    App.tsx (Router)                              │
│  - Detects URL pattern /bounties/:id                             │
│  - Fetches bounty data via getBounty(id)                         │
│  - Renders BountyDetailPage component                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              BountyDetailPage.tsx                                │
│                                                                  │
│  useEffect(() => {                                               │
│    updateSocialMetaTags(bounty);  ◄─── Triggered when bounty    │
│                                         data loads               │
│    return () => {                                                │
│      updateSocialMetaTags(null);  ◄─── Cleanup on unmount       │
│    };                                                            │
│  }, [bounty]);                                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   metaTags.ts                                    │
│                                                                  │
│  updateSocialMetaTags(bounty) {                                  │
│    if (!bounty) {                                                │
│      // Reset to defaults                                        │
│      updateMetaTag("og:title", "Stellar Bounty Board")          │
│      updateMetaTag("og:description", "Fund GitHub issues...")    │
│      // ... more defaults                                        │
│    } else {                                                      │
│      // Update with bounty data                                  │
│      updateMetaTag("og:title", bounty.title)                     │
│      updateMetaTag("og:description",                             │
│        `${bounty.summary} • Reward: ${bounty.amount}...`)        │
│      updateMetaTag("og:url",                                     │
│        `${origin}/bounties/${bounty.id}`)                        │
│      updateMetaTag("og:image",                                   │
│        `https://github.com/${owner}.png?size=400`)               │
│      // ... more meta tags                                       │
│    }                                                             │
│  }                                                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Document Head (DOM)                             │
│                                                                  │
│  <head>                                                          │
│    <meta property="og:title"                                     │
│          content="Add authentication feature" />                 │
│    <meta property="og:description"                               │
│          content="Implement OAuth2... • Reward: 500 XLM" />      │
│    <meta property="og:url"                                       │
│          content="https://stellar-bounty.com/bounties/..." />    │
│    <meta property="og:image"                                     │
│          content="https://github.com/stellar.png?size=400" />    │
│    <meta name="twitter:card" content="summary" />                │
│    <meta name="twitter:title"                                    │
│          content="Add authentication feature" />                 │
│    <!-- ... more meta tags ... -->                               │
│  </head>                                                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Social Media Platform Crawler                       │
│  (Twitter, Facebook, LinkedIn, etc.)                             │
│                                                                  │
│  1. User shares link on social media                             │
│  2. Platform crawler fetches the URL                             │
│  3. Crawler reads meta tags from HTML                            │
│  4. Platform generates rich preview card                         │
└─────────────────────────────────────────────────────────────────┘
```

## Meta Tag Update Flow

```
┌──────────────┐
│ Bounty Data  │
│   Loaded     │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Extract Information                                       │
│ • title: "Add authentication feature"                     │
│ • summary: "Implement OAuth2 authentication for the API"  │
│ • amount: 500                                             │
│ • tokenSymbol: "XLM"                                      │
│ • repo: "stellar/soroban-example"                         │
│ • id: "bounty-123"                                        │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Build Meta Tag Values                                     │
│ • og:title = title                                        │
│ • og:description = summary + " • Reward: " + amount      │
│ • og:url = origin + "/bounties/" + id                    │
│ • og:image = "https://github.com/" + owner + ".png"      │
└──────┬���──────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Update DOM                                                │
│ For each meta tag:                                        │
│   1. Search for existing tag                              │
│   2. If found: update content attribute                   │
│   3. If not found: create new tag and append to head      │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Result: Updated Meta Tags in Document Head               │
└───────────────────────────────────────────────────────────┘
```

## Navigation Flow

```
Homepage (/)
├── Default meta tags
│   ├── og:title: "Stellar Bounty Board"
│   ├── og:description: "Fund GitHub issues..."
│   └── og:type: "website"
│
└── User clicks bounty
    │
    ▼
Bounty Detail (/bounties/bounty-123)
├── Meta tags updated with bounty data
│   ├── og:title: "Add authentication feature"
│   ├── og:description: "Implement OAuth2... • Reward: 500 XLM"
│   ├── og:type: "article"
│   └── og:image: "https://github.com/stellar.png?size=400"
│
└── User navigates back
    │
    ▼
Homepage (/)
└── Meta tags reset to defaults (cleanup function)
```

## Social Sharing Flow

```
┌─────────────────┐
│ User copies URL │
│ /bounties/123   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ User pastes URL into    │
│ Twitter/Facebook/etc.   │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Platform Crawler                         │
│ 1. Fetches URL                           │
│ 2. Parses HTML                           │
│ 3. Reads meta tags                       │
│ 4. Extracts:                             │
│    - og:title                            │
│    - og:description                      │
│    - og:image                            │
│    - og:url                              │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Rich Preview Card Generated              │
│ ┌─────────────────────────────────────┐ │
│ │ [Avatar Image]                      │ │
│ │                                     │ │
│ │ Add authentication feature          │ │
│ │ Implement OAuth2 authentication     │ │
│ │ for the API • Reward: 500 XLM       │ │
│ │                                     │ │
│ │ stellar-bounty.com                  │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Key Points

1. **Dynamic Updates**: Meta tags are updated in real-time when bounty data loads
2. **Cleanup**: Tags are reset when navigating away to prevent stale data
3. **No Duplicates**: Function checks for existing tags before creating new ones
4. **URL Encoding**: Special characters in bounty IDs are properly encoded
5. **Fallback**: Default tags in index.html serve as fallback for homepage
6. **Performance**: Minimal overhead - only updates when bounty changes
