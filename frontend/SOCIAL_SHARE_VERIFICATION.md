# Social Share Meta Tags - Verification Guide

## Overview
Social share meta tags (Open Graph and Twitter Card) have been implemented for bounty detail pages to provide rich previews when sharing bounty links on social media platforms.

## Implementation Details

### Files Modified/Created
1. **`src/metaTags.ts`** - New utility module for managing social meta tags
2. **`src/metaTags.test.ts`** - Test suite for meta tags functionality
3. **`src/BountyDetailPage.tsx`** - Updated to call `updateSocialMetaTags()` when bounty data loads
4. **`index.html`** - Added default Open Graph and Twitter Card meta tags

### Meta Tags Implemented

#### Open Graph Tags
- `og:title` - Bounty title
- `og:description` - Bounty summary + amount + token (e.g., "Fix login bug • Reward: 500 XLM")
- `og:url` - Canonical bounty permalink (e.g., `https://stellar-bounty.com/bounties/bounty-123`)
- `og:type` - Set to "article" for bounty pages, "website" for homepage
- `og:image` - Repository owner's GitHub avatar (400x400px)

#### Twitter Card Tags
- `twitter:card` - Set to "summary"
- `twitter:title` - Bounty title
- `twitter:description` - Bounty summary + amount + token
- `twitter:image` - Repository owner's GitHub avatar

### Dynamic Updates
- Meta tags are updated automatically when bounty data loads
- Tags are reset to default values when navigating away from a bounty detail page
- Document title is also updated to include the bounty title

## Verification Steps

### 1. Local Testing

#### Check Meta Tags in Browser
1. Start the development server: `npm run dev`
2. Navigate to a bounty detail page (e.g., `/bounties/bounty-123`)
3. Open browser DevTools (F12)
4. In the Console, run:
   ```javascript
   // Check Open Graph tags
   document.querySelector('meta[property="og:title"]').content
   document.querySelector('meta[property="og:description"]').content
   document.querySelector('meta[property="og:url"]').content
   document.querySelector('meta[property="og:image"]').content
   
   // Check Twitter Card tags
   document.querySelector('meta[name="twitter:card"]').content
   document.querySelector('meta[name="twitter:title"]').content
   document.querySelector('meta[name="twitter:description"]').content
   document.querySelector('meta[name="twitter:image"]').content
   ```

#### Verify Dynamic Updates
1. Navigate to homepage - meta tags should show default values
2. Navigate to a bounty detail page - meta tags should update with bounty data
3. Navigate back to homepage - meta tags should reset to defaults

### 2. Twitter Card Validator

**Important:** The Twitter Card Validator requires a publicly accessible URL. You cannot test with localhost.

#### Steps:
1. Deploy your application to a staging or production environment
2. Visit [Twitter Card Validator](https://cards-dev.twitter.com/validator)
3. Enter a bounty detail page URL (e.g., `https://your-domain.com/bounties/bounty-123`)
4. Click "Preview card"

#### Expected Result:
- Card type: Summary
- Title: The bounty title
- Description: Bounty summary with reward amount
- Image: Repository owner's GitHub avatar

### 3. Facebook Sharing Debugger

Facebook's debugger can also validate Open Graph tags:

1. Visit [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
2. Enter a bounty detail page URL
3. Click "Debug"

#### Expected Result:
- Title: The bounty title
- Description: Bounty summary with reward amount
- Image: Repository owner's GitHub avatar
- URL: Canonical bounty permalink

### 4. LinkedIn Post Inspector

LinkedIn also uses Open Graph tags:

1. Visit [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/)
2. Enter a bounty detail page URL
3. Click "Inspect"

## Acceptance Criteria Checklist

- [x] `og:title` set to bounty title
- [x] `og:description` set to bounty summary + amount + token
- [x] `og:url` set to canonical bounty permalink
- [x] `og:image` set to repository owner's GitHub avatar
- [x] `twitter:card` set to "summary"
- [x] Meta tags updated dynamically when bounty data loads
- [x] Document title updated with bounty title
- [ ] Verified working in Twitter Card Validator (requires deployment)

## Testing

Run the test suite:
```bash
npm test metaTags.test.ts
```

The test suite covers:
- Default meta tags when no bounty is loaded
- Meta tags updated with bounty data
- Special characters in bounty IDs (URL encoding)
- Updating existing tags instead of creating duplicates
- Removing image tags when resetting to defaults

## Troubleshooting

### Meta tags not updating
- Check browser console for JavaScript errors
- Verify the `updateSocialMetaTags()` function is being called in the useEffect
- Ensure bounty data is loaded before meta tags are updated

### Social media platforms not showing preview
- Verify the URL is publicly accessible (not localhost)
- Check that meta tags are present in the HTML source (View Page Source)
- Use the platform's debugging tool to see what they're reading
- Some platforms cache previews - you may need to clear the cache or wait

### Image not displaying
- Verify the GitHub avatar URL is accessible
- Check that the repository owner name is correctly extracted from `bounty.repo`
- Ensure the image URL uses HTTPS

## Future Enhancements

Potential improvements for future iterations:
- Add `og:site_name` meta tag
- Add custom Open Graph image with bounty details rendered
- Support for `twitter:card` type "summary_large_image" with custom graphics
- Add structured data (JSON-LD) for better SEO
- Add `og:locale` for internationalization
