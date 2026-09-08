import type { ObjectDirective } from 'vue';

const cleanups = new WeakMap<HTMLElement, () => void>();
const enabled = new WeakMap<HTMLElement, boolean>();

/** 内容流式更新时跟随底部，鼠标移入后保留用户阅读位置。 */
export const vFollowScroll: ObjectDirective<HTMLElement> = {
  mounted(element, binding) {
    enabled.set(element, binding.value !== false);
    let hovering = false;
    const follow = () => {
      if (!hovering && enabled.get(element)) element.scrollTop = element.scrollHeight;
    };
    const enter = () => {
      hovering = true;
    };
    const leave = () => {
      hovering = false;
      follow();
    };
    const observer = new MutationObserver(follow);
    observer.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    element.addEventListener('mouseenter', enter);
    element.addEventListener('mouseleave', leave);
    element.addEventListener('load', follow, true);
    cleanups.set(element, () => {
      observer.disconnect();
      element.removeEventListener('mouseenter', enter);
      element.removeEventListener('mouseleave', leave);
      element.removeEventListener('load', follow, true);
    });
    follow();
  },
  updated(element, binding) {
    enabled.set(element, binding.value !== false);
  },
  unmounted(element) {
    enabled.delete(element);
    cleanups.get(element)?.();
    cleanups.delete(element);
  },
};
