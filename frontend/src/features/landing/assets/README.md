# Landing assets

Exports from the Figma landing design (file `V66rN97MQiP3ezpNpLL7MD`, frame "Desktop - 6"), downloaded September 25, 2026: school logo tiles, avatars, the world-map dots, and the icon SVGs used by the illustrated feature cards.

`wordmark-hero.svg` and `wordmark-footer.svg` are the "Acceptra" wordmark set in Geom and exported as outlines, because Geom is not a web font we ship; their viewBoxes reproduce the original text boxes (96×29 at 23px Medium, 90×28 at 22px Regular).

The hero is the "Desktop - 9" hero frame (node `538:116`), exported September 27, 2026: `ring-*.svg` are its icons. Its school and activity logos are the same files the feature cards use.

`counselle.svg` reuses the existing mark from `features/shell/CounselleLogo.tsx` as the landing favicon.

`compare-chatgpt.svg` is the OpenAI mark, from its own site, for the ChatGPT column of the comparison table.

`mark-*.png` are the schools marquee logos: each school's logo in its own colours with the tile background removed (132px tall, transparent). Where the source was a white letter on a coloured tile, the letter takes the tile's colour. The marquee mutes them with a CSS filter.
