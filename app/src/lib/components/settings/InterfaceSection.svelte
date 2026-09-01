<script lang="ts">
  /* Erscheinungsbild und Bedienung waren zwei sehr kurze Abschnitte, zwischen
     denen niemand zuverlässig raten konnte, wo eine Einstellung wohnt: Hell/
     Dunkel hier, Kontrollflächen dort, Sprache wieder woanders. Zusammengelegt
     zu „Oberfläche & Bedienung".

     Bewusst als dünne Klammer über den beiden bestehenden Komponenten statt als
     Zusammenkopieren: beide tragen eigene Zustände, Tests und Vertragszusagen,
     und die bleiben unangetastet. Die Reihenfolge folgt der Häufigkeit — zuerst
     das, was man oft ändert. */
  import AppearanceSection from './AppearanceSection.svelte';
  import LayoutSection from './LayoutSection.svelte';
</script>

<AppearanceSection />
<LayoutSection />
