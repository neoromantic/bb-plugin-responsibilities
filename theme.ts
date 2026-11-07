export const COMPACT_THEME = String.raw`
:root, .light {
  --canvas: #f5f2eb;
  --ink: #39352e;
  --primary: #80613c;
  --primary-foreground: #fffaf2;
  --sidebar: #eeebe3;
  --muted-foreground: color-mix(in oklch, var(--ink) 75%, var(--canvas));
  --subtle-foreground: color-mix(in oklch, var(--ink) 60%, var(--canvas));
  --readback-foreground: color-mix(in oklch, var(--ink) 65%, var(--canvas));
  --bb-sidebar-row-height: 26px;
  --compact-indent: 8px;
}

@media (pointer: fine) {
  .group\/thread-row {
    height: 26px !important;
    min-height: 26px;
  }

  .group\/thread-row [data-sidebar-thread-trailing] .h-7 {
    height: 26px;
  }
}

.dark {
  --canvas: #211f1c;
  --ink: #ddd7cd;
  --primary: #d5ba8d;
  --primary-foreground: #211f1c;
  --sidebar: #1c1a17;
}

[data-promptbox] {
  background-color: color-mix(in oklch, var(--ink) 3%, var(--canvas));
}


:root {
  --compact-indent: 8px;
  --compact-parent-indent: -2px;
  --compact-parent-depth: -1;
}

[data-sidebar-sticky-group]:has(> .group\/thread-row) {
  --compact-depth: calc(var(--compact-parent-depth) + 1);
  --compact-step: clamp(8px, calc(16px - var(--compact-depth) * 2px), 10px);
  --compact-indent: calc(var(--compact-parent-indent) + var(--compact-step));

  > div {
    --compact-parent-indent: var(--compact-indent);
    --compact-parent-depth: var(--compact-depth);

    > .bg-border-hairline[style] {
      display: none;
    }
  }
}

[data-resp-guide] {
  --compact-guide-row-height: var(--bb-sidebar-row-height);
  --compact-guide-color: color-mix(in oklch, var(--primary) 45%, var(--sidebar));
  position: relative;

  @media (width < 48rem) and (pointer: coarse) {
    --compact-guide-row-height: var(--bb-sidebar-row-height-coarse);
  }

  &::after {
    content: "";
    position: absolute;
    pointer-events: none;
    left: calc(var(--compact-indent) + 4px);
    top: -2px;
    bottom: -2px;
    width: 4px;
    z-index: calc(var(--bb-sidebar-sticky-parent-base-z) - var(--compact-depth) - 1);
    background:
      linear-gradient(var(--compact-guide-color) 0 0) 0 0 / 1px 100% no-repeat,
      linear-gradient(var(--compact-guide-color) 0 0) 0 calc(var(--compact-guide-row-height) / 2 + 2px) / 4px 1px no-repeat;
  }

  &[data-resp-guide="end"]::after {
    bottom: auto;
    height: calc(var(--compact-guide-row-height) / 2 + 3px);
  }

  &[data-resp-guide="through"]::after {
    background-size: 1px 100%, 0 0;
  }
}

.group\/thread-row {
  padding-left: var(--compact-indent) !important;

  &[data-resp-path]:not(.bb-sidebar-selected-row) {
    background-color: color-mix(in oklch, var(--primary) 4%, var(--sidebar));
  }

  &[data-resp-manager] .bb-thread-title {
    font-weight: 600;
    color: var(--ink);
  }

  &:hover:not(.bb-sidebar-selected-row) {
    background-color: var(--sidebar-accent);
  }

  &.bb-sidebar-selected-row {
    background: color-mix(in oklch, var(--primary) 17%, var(--sidebar));
    box-shadow: inset 2px 0 var(--primary);
  }

  > span[style*="--bb-sidebar-hover-actions-inset"] {
    padding-right: 0;
  }

  @media (hover: hover) {
    &:is(:hover, :has(:focus-visible), :has([data-sidebar-hover-actions-open="true"])) > span[style*="--bb-sidebar-hover-actions-inset"] {
      mask-image: linear-gradient(to left, transparent var(--bb-sidebar-hover-actions-inset), black calc(var(--bb-sidebar-hover-actions-inset) + 8px));
    }
  }
}
`;
